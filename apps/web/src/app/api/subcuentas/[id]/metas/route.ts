import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';
import { esquemaMetas, guardarMetas, obtenerMetas } from '@/servidor/metas';

type Params = { params: Promise<{ id: string }> };

export const GET = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  return json(await obtenerMetas(obtenerDb(), ctx, (await params).id));
});

/** Metas y umbrales: admin, dueño o quien tenga "Metas" con editar en esa subcuenta. */
export const PUT = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaMetas);
  return json(await guardarMetas(obtenerDb(), ctx, (await params).id, datos));
});
