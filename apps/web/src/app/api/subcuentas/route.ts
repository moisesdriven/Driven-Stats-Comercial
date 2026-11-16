import { listarSubcuentas } from '@/servidor/consultas/subcuentas';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';

export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json({ subcuentas: await listarSubcuentas(obtenerDb(), ctx) });
});
