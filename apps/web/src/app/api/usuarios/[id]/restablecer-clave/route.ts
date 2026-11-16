import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';
import { restablecerClave } from '@/servidor/usuarios';

export const POST = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const { id } = await params;
  return json(await restablecerClave(obtenerDb(), ctx, id));
});
