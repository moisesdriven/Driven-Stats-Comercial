import { resumenSubcuenta } from '@/servidor/consultas/subcuentas';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';
import { leerRango } from '@/servidor/rango';

export const GET = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const { id } = await params;
  const { desde, hasta } = leerRango(req);
  return json({ resumen: await resumenSubcuenta(obtenerDb(), ctx, id, desde, hasta) });
});
