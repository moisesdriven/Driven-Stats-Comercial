import { z } from 'zod';
import { cambiarClave } from '@/servidor/autenticacion';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

const esquema = z.object({
  claveActual: z.string().min(1).max(200),
  claveNueva: z.string().min(1).max(200),
});

export const POST = manejar(async (req) => {
  const { ctx, sesion } = await requerirSesion(req, { permitirCambioPendiente: true });
  await cambiarClave(obtenerDb(), ctx, sesion.id, await leerJson(req, esquema));
  return json({ ok: true });
});
