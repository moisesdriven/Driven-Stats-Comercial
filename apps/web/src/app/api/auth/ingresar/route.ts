import { z } from 'zod';
import { ingresar } from '@/servidor/autenticacion';
import { obtenerDb } from '@/servidor/db';
import { ipDe, json, leerJson, manejar, ponerCookieSesion } from '@/servidor/http';

const esquema = z.object({
  correo: z.string().min(1, 'Ingresa tu correo.').max(200),
  clave: z.string().min(1, 'Ingresa tu contraseña.').max(200),
});

export const POST = manejar(async (req) => {
  const datos = await leerJson(req, esquema);
  const r = await ingresar(obtenerDb(), {
    ...datos,
    ip: ipDe(req),
    agente: req.headers.get('user-agent'),
  });
  const res = json({ requiere2fa: r.requiere2fa, debeCambiarClave: r.debeCambiarClave });
  ponerCookieSesion(res, r.token, r.expiraEn);
  return res;
});
