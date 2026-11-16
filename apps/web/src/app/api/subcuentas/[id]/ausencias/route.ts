import { obtenerDb } from '@/servidor/db';
import { esquemaAusencia, registrarAusencia } from '@/servidor/horarios';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

export const POST = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaAusencia);
  return json(await registrarAusencia(obtenerDb(), ctx, (await params).id, datos), 201);
});
