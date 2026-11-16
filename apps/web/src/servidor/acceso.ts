/**
 * Capa de acceso (§10.1). Se recalcula en CADA petición desde la base, así los cambios de rol,
 * subcuentas o módulos se aplican en la siguiente petición sin volver a iniciar sesión.
 *
 * Regla: toda consulta de datos recibe un ContextoAcceso y filtra con `subcuentasPermitidas` (y con
 * `userIdGhl` si es asesor). Nunca se confía en filtros enviados por el navegador.
 */
import { eq } from 'drizzle-orm';
import {
  alcanzaNivel,
  nivelesEfectivos,
  MODULOS,
  type Modulo,
  type Nivel,
  type Rol,
} from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { prohibido } from './errores';

export interface ContextoAcceso {
  usuarioId: string;
  correo: string;
  nombre: string;
  rol: Rol;
  /** Subcuentas que puede ver. El administrador ve siempre todas las existentes. */
  subcuentas: string[];
  /** userId de GHL vinculado (obligatorio para el asesor: solo ve lo propio). */
  userIdGhl: string | null;
  modulos: Record<Modulo, Nivel>;
  totpActivo: boolean;
  debeCambiarClave: boolean;
}

const esModulo = (m: string): m is Modulo => (MODULOS as readonly string[]).includes(m);

export async function cargarContexto(db: Db, usuarioId: string): Promise<ContextoAcceso | null> {
  const [u] = await db
    .select()
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.id, usuarioId))
    .limit(1);
  if (!u || !u.activo) return null;

  const [porRol, excepciones, asignadas, vinculo] = await Promise.all([
    db.select().from(tablas.permisosRol).where(eq(tablas.permisosRol.rol, u.rol)),
    db.select().from(tablas.permisosUsuario).where(eq(tablas.permisosUsuario.usuarioId, u.id)),
    u.rol === 'admin'
      ? db.select({ locationId: tablas.subcuentas.locationId }).from(tablas.subcuentas)
      : db
          .select({ locationId: tablas.usuarioSubcuenta.locationId })
          .from(tablas.usuarioSubcuenta)
          .where(eq(tablas.usuarioSubcuenta.usuarioId, u.id)),
    db.select().from(tablas.usuarioAsesor).where(eq(tablas.usuarioAsesor.usuarioId, u.id)).limit(1),
  ]);

  const matrizRol: Partial<Record<Modulo, Nivel>> = {};
  for (const p of porRol) if (esModulo(p.modulo)) matrizRol[p.modulo] = p.nivel;
  const matrizUsuario: Partial<Record<Modulo, Nivel>> = {};
  for (const p of excepciones) if (esModulo(p.modulo)) matrizUsuario[p.modulo] = p.nivel;

  return {
    usuarioId: u.id,
    correo: u.correo,
    nombre: u.nombre,
    rol: u.rol,
    subcuentas: asignadas.map((s) => s.locationId).sort(),
    userIdGhl: vinculo[0]?.userId ?? null,
    modulos: nivelesEfectivos(u.rol, matrizUsuario, matrizRol),
    totpActivo: u.totpSecretoCifrado !== null,
    debeCambiarClave: u.debeCambiarClave,
  };
}

export function exigirModulo(
  ctx: ContextoAcceso,
  modulo: Modulo,
  nivel: Exclude<Nivel, 'ninguno'> = 'ver',
): void {
  if (!alcanzaNivel(ctx.modulos[modulo], nivel)) throw prohibido();
}

export function exigirAdmin(ctx: ContextoAcceso): void {
  if (ctx.rol !== 'admin') throw prohibido('Solo un administrador puede hacer esto.');
}

/**
 * Lanza 403 si la subcuenta no está entre las del usuario. Responde 403 (no 404) también cuando la
 * subcuenta no existe, para no revelar qué subcuentas hay.
 */
export function exigirSubcuenta(ctx: ContextoAcceso, locationId: string): void {
  if (!ctx.subcuentas.includes(locationId)) throw prohibido('No tienes acceso a esta subcuenta.');
}

/** El asesor solo puede consultar su propio userId de GHL. */
export function exigirAsesorPropio(ctx: ContextoAcceso, userIdGhl: string): void {
  if (ctx.rol === 'asesor' && ctx.userIdGhl !== userIdGhl) {
    throw prohibido('Solo puedes ver tu propio detalle.');
  }
}
