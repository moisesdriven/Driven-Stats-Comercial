import { esquemaAnalizador, estimarAnalizador } from '@/servidor/analizador';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

/** Estimación previa al analizador a pedido (solo administradores). */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json(await estimarAnalizador(obtenerDb(), ctx, await leerJson(req, esquemaAnalizador)));
});
