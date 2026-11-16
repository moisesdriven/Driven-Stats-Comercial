import { cookies, headers } from 'next/headers';
import { forbidden, notFound, redirect } from 'next/navigation';
import { alcanzaNivel, type Modulo, type Nivel } from '@driven/core';
import { cargarContexto, type ContextoAcceso } from './acceso';
import { obtenerDb } from './db';
import { ErrorHttp } from './errores';
import { leerSesion, NOMBRE_COOKIE, type SesionActiva } from './sesiones';

export interface EstadoSesion {
  ctx: ContextoAcceso;
  sesion: SesionActiva;
}

/** Sesión para páginas (Server Components). `null` si no hay sesión válida. */
export async function obtenerSesionPagina(): Promise<EstadoSesion | null> {
  await headers();
  const token = (await cookies()).get(NOMBRE_COOKIE)?.value;
  const db = obtenerDb();
  const sesion = await leerSesion(db, token);
  if (!sesion) return null;
  const ctx = await cargarContexto(db, sesion.usuarioId);
  return ctx ? { ctx, sesion } : null;
}

/** Exige sesión completa (2FA verificado y contraseña ya cambiada); si no, redirige al paso que falta. */
export async function requerirSesionPagina(): Promise<EstadoSesion> {
  const estado = await obtenerSesionPagina();
  if (!estado) redirect('/ingresar');
  if (estado.ctx.totpActivo && !estado.sesion.verificada2fa) redirect('/verificar');
  if (estado.ctx.debeCambiarClave) redirect('/cambiar-clave');
  return estado;
}

/** Exige sesión completa y un módulo (403 si no lo tiene: §10.1). */
export async function requerirModuloPagina(
  modulo: Modulo,
  nivel: Exclude<Nivel, 'ninguno'> = 'ver',
): Promise<EstadoSesion> {
  const estado = await requerirSesionPagina();
  if (!alcanzaNivel(estado.ctx.modulos[modulo], nivel)) forbidden();
  return estado;
}

/** 403 si la subcuenta no está entre las del usuario (aunque cambie la URL). */
export function exigirSubcuentaPagina(ctx: ContextoAcceso, locationId: string): void {
  if (!ctx.subcuentas.includes(locationId)) forbidden();
}

/** Página de inicio según el rol: vista general, su subcuenta o su propio detalle. */
export function inicioDe(ctx: ContextoAcceso): string {
  if (ctx.modulos.vista_general !== 'ninguno') return '/';
  const primera = ctx.subcuentas[0];
  if (!primera) return '/sin-subcuentas';
  if (ctx.modulos.vista_subcuenta !== 'ninguno') return `/subcuentas/${primera}`;
  if (ctx.userIdGhl && ctx.modulos.detalle_asesores !== 'ninguno')
    return `/subcuentas/${primera}/asesores/${ctx.userIdGhl}`;
  return '/sin-subcuentas';
}

/**
 * Para páginas: una consulta que rechaza por permisos (ErrorHttp 401/403) responde 403 y una que no
 * encuentra el recurso, 404, en lugar de un error 500.
 */
export async function enPagina<T>(promesa: Promise<T>): Promise<T> {
  try {
    return await promesa;
  } catch (e) {
    if (e instanceof ErrorHttp && (e.estado === 401 || e.estado === 403)) forbidden();
    if (e instanceof ErrorHttp && e.estado === 404) notFound();
    throw e;
  }
}
