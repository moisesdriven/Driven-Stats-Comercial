import { and, eq, gt, sql } from 'drizzle-orm';
import { descifrar, tablas, type Db } from '@driven/db';
import type { ContextoAcceso } from './acceso';
import { auditar } from './auditoria';
import { hashearClave, obtenerHashRelleno, validarClaveNueva, verificarClave } from './claves';
import { ErrorHttp, solicitudInvalida } from './errores';
import { crearSesion, eliminarSesionesDeUsuario, marcarSesion2fa } from './sesiones';
import { verificarCodigoTotp } from './totp';

/** Máximo de intentos fallidos por correo en la ventana, antes de bloquear temporalmente. */
const MAX_FALLIDOS = 5;
const VENTANA_MIN = 15;

export const normalizarCorreo = (c: string) => c.trim().toLowerCase();

export interface ResultadoIngreso {
  token: string;
  expiraEn: Date;
  requiere2fa: boolean;
  debeCambiarClave: boolean;
}

export async function ingresar(
  db: Db,
  datos: { correo: string; clave: string; ip: string | null; agente: string | null },
): Promise<ResultadoIngreso> {
  const correo = normalizarCorreo(datos.correo);

  const [{ fallidos } = { fallidos: 0 }] = await db
    .select({ fallidos: sql<number>`count(*)::int` })
    .from(tablas.auditoria)
    .where(
      and(
        eq(tablas.auditoria.que, 'ingreso_fallido'),
        sql`${tablas.auditoria.detalle}->>'correo' = ${correo}`,
        gt(tablas.auditoria.cuando, sql`now() - make_interval(mins => ${VENTANA_MIN})`),
      ),
    );
  if (fallidos >= MAX_FALLIDOS) {
    throw new ErrorHttp(
      429,
      `Demasiados intentos. Espera ${VENTANA_MIN} minutos e inténtalo de nuevo.`,
      'demasiados_intentos',
    );
  }

  const [u] = await db
    .select()
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.correo, correo))
    .limit(1);
  // Siempre se verifica un hash para que el tiempo de respuesta no revele si el correo existe.
  const valida = await verificarClave(u?.hash ?? (await obtenerHashRelleno()), datos.clave);
  if (!u || !valida || !u.activo) {
    await auditar(db, u?.id ?? null, 'ingreso_fallido', {
      correo,
      ip: datos.ip,
      motivo: !u ? 'correo' : !valida ? 'clave' : 'inactivo',
    });
    throw new ErrorHttp(401, 'Correo o contraseña incorrectos.', 'credenciales');
  }

  const requiere2fa = u.totpSecretoCifrado !== null;
  const { token, expiraEn } = await crearSesion(db, u.id, {
    verificada2fa: !requiere2fa,
    ip: datos.ip,
    agente: datos.agente,
  });
  if (!requiere2fa) {
    await db
      .update(tablas.usuarios)
      .set({ ultimoIngreso: new Date() })
      .where(eq(tablas.usuarios.id, u.id));
  }
  await auditar(db, u.id, 'ingreso', { ip: datos.ip, requiere2fa });
  return { token, expiraEn, requiere2fa, debeCambiarClave: u.debeCambiarClave };
}

async function secretoTotp(db: Db, usuarioId: string): Promise<string | null> {
  const [u] = await db
    .select({ s: tablas.usuarios.totpSecretoCifrado })
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.id, usuarioId))
    .limit(1);
  return u?.s ? descifrar(u.s) : null;
}

export async function verificarSegundoFactor(
  db: Db,
  usuarioId: string,
  sesionId: string,
  codigo: string,
): Promise<void> {
  const secreto = await secretoTotp(db, usuarioId);
  if (!secreto || !verificarCodigoTotp(secreto, codigo)) {
    await auditar(db, usuarioId, '2fa_fallido', {});
    throw new ErrorHttp(401, 'Código incorrecto.', 'codigo_2fa');
  }
  await marcarSesion2fa(db, sesionId);
  await db
    .update(tablas.usuarios)
    .set({ ultimoIngreso: new Date() })
    .where(eq(tablas.usuarios.id, usuarioId));
  await auditar(db, usuarioId, '2fa_verificado', {});
}

export async function cambiarClave(
  db: Db,
  ctx: ContextoAcceso,
  sesionId: string,
  datos: { claveActual: string; claveNueva: string },
): Promise<void> {
  const [u] = await db
    .select()
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.id, ctx.usuarioId))
    .limit(1);
  if (!u || !(await verificarClave(u.hash, datos.claveActual))) {
    throw new ErrorHttp(401, 'La contraseña actual no es correcta.', 'credenciales');
  }
  const error = validarClaveNueva(datos.claveNueva);
  if (error) throw solicitudInvalida(error);
  if (datos.claveNueva === datos.claveActual) {
    throw solicitudInvalida('La nueva contraseña debe ser distinta de la actual.');
  }
  await db
    .update(tablas.usuarios)
    .set({ hash: await hashearClave(datos.claveNueva), debeCambiarClave: false })
    .where(eq(tablas.usuarios.id, u.id));
  await eliminarSesionesDeUsuario(db, u.id, sesionId);
  await auditar(db, u.id, 'clave_cambiada', {});
}

/**
 * Revalidación para acciones sensibles (p. ej. lanzar un análisis de calidad, §6.5): con 2FA activo
 * se pide el código; sin 2FA, la contraseña.
 */
export async function reautenticar(
  db: Db,
  ctx: ContextoAcceso,
  datos: { clave?: string | undefined; codigo?: string | undefined },
): Promise<void> {
  if (ctx.totpActivo) {
    const secreto = await secretoTotp(db, ctx.usuarioId);
    if (!secreto || !datos.codigo || !verificarCodigoTotp(secreto, datos.codigo)) {
      throw new ErrorHttp(401, 'El código de verificación no es correcto.', 'reautenticacion');
    }
    return;
  }
  const [u] = await db
    .select({ hash: tablas.usuarios.hash })
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.id, ctx.usuarioId))
    .limit(1);
  if (!u || !datos.clave || !(await verificarClave(u.hash, datos.clave))) {
    throw new ErrorHttp(401, 'La contraseña no es correcta.', 'reautenticacion');
  }
}
