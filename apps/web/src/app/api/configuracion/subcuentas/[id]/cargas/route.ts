import { cargasRecientes } from '@/servidor/configuracion';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';

export const GET = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  return json({ cargas: await cargasRecientes(obtenerDb(), ctx, (await params).id) });
});
