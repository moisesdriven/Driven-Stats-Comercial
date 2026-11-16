import { vistaGeneral } from '@/servidor/consultas/indicadores';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';
import { leerRango } from '@/servidor/rango';

export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  const { desde, hasta } = leerRango(req);
  return json(await vistaGeneral(obtenerDb(), ctx, desde, hasta));
});
