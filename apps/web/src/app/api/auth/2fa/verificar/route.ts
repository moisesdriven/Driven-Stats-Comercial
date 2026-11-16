import { z } from 'zod';
import { verificarSegundoFactor } from '@/servidor/autenticacion';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

const esquema = z.object({ codigo: z.string().min(6).max(10) });

export const POST = manejar(async (req) => {
  const { ctx, sesion } = await requerirSesion(req, {
    permitir2faPendiente: true,
    permitirCambioPendiente: true,
  });
  const { codigo } = await leerJson(req, esquema);
  await verificarSegundoFactor(obtenerDb(), ctx.usuarioId, sesion.id, codigo);
  return json({ ok: true, debeCambiarClave: ctx.debeCambiarClave });
});
