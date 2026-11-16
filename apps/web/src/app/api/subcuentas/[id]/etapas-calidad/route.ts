import {
  esquemaEtapasCalidad,
  etapasDeSubcuenta,
  guardarEtapasCalidad,
} from '@/servidor/configuracion';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

type Params = { params: Promise<{ id: string }> };

export const GET = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  return json(await etapasDeSubcuenta(obtenerDb(), ctx, (await params).id));
});

/** Elegir las 3 etapas de calidad: admin, dueño o quien tenga "Metas" con editar en esa subcuenta. */
export const PUT = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaEtapasCalidad);
  return json(await guardarEtapasCalidad(obtenerDb(), ctx, (await params).id, datos));
});
