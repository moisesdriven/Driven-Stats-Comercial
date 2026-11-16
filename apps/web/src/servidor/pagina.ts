import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cargarContexto, type ContextoAcceso } from './acceso';
import { obtenerDb } from './db';
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
