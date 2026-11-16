import { obtenerDb } from '@/servidor/db';
import { esquemaHorario, guardarHorario, obtenerHorarios } from '@/servidor/horarios';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

type Params = { params: Promise<{ id: string }> };

export const GET = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  return json(await obtenerHorarios(obtenerDb(), ctx, (await params).id));
});

export const PUT = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaHorario);
  return json(await guardarHorario(obtenerDb(), ctx, (await params).id, datos));
});
