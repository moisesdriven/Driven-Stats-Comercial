import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { cargarContexto, type ContextoAcceso } from './acceso';
import { obtenerDb } from './db';
import { ErrorHttp, noAutenticado, prohibido, solicitudInvalida } from './errores';
import { eliminarSesion, leerSesion, NOMBRE_COOKIE, type SesionActiva } from './sesiones';

export function leerCookie(req: Request, nombre: string): string | undefined {
  const cabecera = req.headers.get('cookie');
  if (!cabecera) return undefined;
  for (const parte of cabecera.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function ipDe(req: Request): string | null {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip');
}

/** Protección CSRF adicional a SameSite=Lax: el Origin, si viene, debe ser el mismo host. */
function verificarOrigen(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origen = req.headers.get('origin');
  if (!origen) return;
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    if (new URL(origen).host !== host) throw prohibido('Origen no permitido.');
  } catch (e) {
    if (e instanceof ErrorHttp) throw e;
    throw prohibido('Origen no permitido.');
  }
}

export interface OpcionesSesion {
  /** Permite sesiones que aún deben ingresar el código 2FA. */
  permitir2faPendiente?: boolean;
  /** Permite usuarios que aún deben cambiar su contraseña temporal. */
  permitirCambioPendiente?: boolean;
}

export interface SesionValidada {
  ctx: ContextoAcceso;
  sesion: SesionActiva;
}

/** Valida la sesión y carga los permisos actuales del usuario desde la base. */
export async function requerirSesion(
  req: Request,
  opciones: OpcionesSesion = {},
): Promise<SesionValidada> {
  verificarOrigen(req);
  const db = obtenerDb();
  const sesion = await leerSesion(db, leerCookie(req, NOMBRE_COOKIE));
  if (!sesion) throw noAutenticado();
  const ctx = await cargarContexto(db, sesion.usuarioId);
  if (!ctx) {
    await eliminarSesion(db, sesion.id);
    throw noAutenticado();
  }
  if (ctx.totpActivo && !sesion.verificada2fa && !opciones.permitir2faPendiente) {
    throw new ErrorHttp(401, 'Ingresa el código de verificación.', 'requiere_2fa');
  }
  if (ctx.debeCambiarClave && !opciones.permitirCambioPendiente) {
    throw new ErrorHttp(403, 'Debes cambiar tu contraseña temporal.', 'debe_cambiar_clave');
  }
  return { ctx, sesion };
}

export async function leerJson<T extends z.ZodType>(req: Request, esquema: T): Promise<z.infer<T>> {
  verificarOrigen(req);
  let datos: unknown;
  try {
    datos = await req.json();
  } catch {
    throw solicitudInvalida('El cuerpo debe ser JSON.');
  }
  const r = esquema.safeParse(datos);
  if (!r.success) throw solicitudInvalida(r.error.issues.map((i) => i.message).join(' '));
  return r.data;
}

export function json(datos: unknown, estado = 200): NextResponse {
  return NextResponse.json(datos, { status: estado, headers: { 'Cache-Control': 'no-store' } });
}

/** Envuelve un handler de ruta: transforma ErrorHttp en JSON y oculta errores internos. */
export function manejar<A extends unknown[]>(
  fn: (req: Request, ...args: A) => Promise<Response>,
): (req: Request, ...args: A) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await fn(req, ...args);
    } catch (e) {
      if (e instanceof ErrorHttp) {
        return json({ error: e.message, codigo: e.codigo ?? null }, e.estado);
      }
      console.error('[api] error interno', e);
      return json({ error: 'Error interno.', codigo: 'interno' }, 500);
    }
  };
}

export function ponerCookieSesion(res: NextResponse, token: string, expiraEn: Date): void {
  res.cookies.set(NOMBRE_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiraEn,
  });
}

export function borrarCookieSesion(res: NextResponse): void {
  res.cookies.set(NOMBRE_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
}
