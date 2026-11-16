import { indicadoresSubcuenta } from '@/servidor/consultas/indicadores';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';
import { leerRango } from '@/servidor/rango';

export const GET = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const { desde, hasta } = leerRango(req);
  return json(await indicadoresSubcuenta(obtenerDb(), ctx, (await params).id, desde, hasta));
});
