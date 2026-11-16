import { obtenerDb } from '@/servidor/db';
import { esquemaModoTiempo, guardarModoTiempo } from '@/servidor/horarios';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

/** Horario laboral o tiempo corrido (24/7) para los cálculos de la subcuenta. */
export const PUT = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaModoTiempo);
  return json(await guardarModoTiempo(obtenerDb(), ctx, (await params).id, datos));
});
