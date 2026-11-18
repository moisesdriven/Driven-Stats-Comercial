import { ajustesCalidad, esquemaAjustesCalidad, guardarAjustesCalidad } from '@/servidor/calidad';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

/** Modelo de IA y tope mensual de los análisis de calidad (solo el administrador global). */
export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json(await ajustesCalidad(obtenerDb(), ctx));
});

export const PUT = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json(
    await guardarAjustesCalidad(obtenerDb(), ctx, await leerJson(req, esquemaAjustesCalidad)),
  );
});
