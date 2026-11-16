import { obtenerDb } from '@/servidor/db';
import { borrarCookieSesion, json, leerCookie, manejar } from '@/servidor/http';
import { eliminarSesion, leerSesion, NOMBRE_COOKIE } from '@/servidor/sesiones';

export const POST = manejar(async (req) => {
  const db = obtenerDb();
  const sesion = await leerSesion(db, leerCookie(req, NOMBRE_COOKIE));
  if (sesion) await eliminarSesion(db, sesion.id);
  const res = json({ ok: true });
  borrarCookieSesion(res);
  return res;
});
