import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';

export const NOMBRE_COOKIE = 'dc_sesion';
/** Duración de una sesión: 12 horas desde el último uso, con un máximo absoluto de 7 días. */
const DURACION_MS = 12 * 60 * 60 * 1000;
const MAXIMO_MS = 7 * 24 * 60 * 60 * 1000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('base64url');

export interface SesionActiva {
  id: string;
  usuarioId: string;
  verificada2fa: boolean;
  expiraEn: Date;
}

export async function crearSesion(
  db: Db,
  usuarioId: string,
  opciones: { verificada2fa: boolean; ip?: string | null; agente?: string | null },
): Promise<{ token: string; expiraEn: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiraEn = new Date(Date.now() + DURACION_MS);
  await db.insert(tablas.sesiones).values({
    id: hashToken(token),
    usuarioId,
    verificada2fa: opciones.verificada2fa,
    expiraEn,
    ip: opciones.ip ?? null,
    agente: opciones.agente?.slice(0, 300) ?? null,
  });
  return { token, expiraEn };
}

/** Devuelve la sesión si existe y no venció; renueva su vencimiento (deslizante). */
export async function leerSesion(db: Db, token: string | undefined): Promise<SesionActiva | null> {
  if (!token) return null;
  const id = hashToken(token);
  const ahora = new Date();
  const [s] = await db
    .select()
    .from(tablas.sesiones)
    .where(and(eq(tablas.sesiones.id, id), gt(tablas.sesiones.expiraEn, ahora)))
    .limit(1);
  if (!s) return null;
  if (ahora.getTime() - s.creadaEn.getTime() > MAXIMO_MS) {
    await db.delete(tablas.sesiones).where(eq(tablas.sesiones.id, id));
    return null;
  }
  // Renueva solo si pasó más de un minuto desde el último uso, para no escribir en cada petición.
  let expiraEn = s.expiraEn;
  if (ahora.getTime() - s.ultimoUso.getTime() > 60_000) {
    expiraEn = new Date(ahora.getTime() + DURACION_MS);
    await db
      .update(tablas.sesiones)
      .set({ ultimoUso: ahora, expiraEn })
      .where(eq(tablas.sesiones.id, id));
  }
  return { id, usuarioId: s.usuarioId, verificada2fa: s.verificada2fa, expiraEn };
}

export async function marcarSesion2fa(db: Db, sesionId: string): Promise<void> {
  await db
    .update(tablas.sesiones)
    .set({ verificada2fa: true })
    .where(eq(tablas.sesiones.id, sesionId));
}

export async function eliminarSesion(db: Db, sesionId: string): Promise<void> {
  await db.delete(tablas.sesiones).where(eq(tablas.sesiones.id, sesionId));
}

/** Cierra todas las sesiones de un usuario (al desactivarlo o restablecer su contraseña). */
export async function eliminarSesionesDeUsuario(db: Db, usuarioId: string, salvo?: string) {
  const sesiones = await db
    .select({ id: tablas.sesiones.id })
    .from(tablas.sesiones)
    .where(eq(tablas.sesiones.usuarioId, usuarioId));
  for (const s of sesiones) if (s.id !== salvo) await eliminarSesion(db, s.id);
}

export async function purgarSesionesVencidas(db: Db): Promise<void> {
  await db.delete(tablas.sesiones).where(lt(tablas.sesiones.expiraEn, new Date()));
}
