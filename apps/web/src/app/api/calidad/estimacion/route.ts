import { esquemaPeriodo, estimarAnalisis } from '@/servidor/calidad';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

/** Estimación previa al botón "Ejecutar análisis de calidad" (solo administradores). */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json(await estimarAnalisis(obtenerDb(), ctx, await leerJson(req, esquemaPeriodo)));
});
