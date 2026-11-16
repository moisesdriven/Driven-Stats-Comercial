import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';
import { actualizarUsuario, esquemaCambiosUsuario } from '@/servidor/usuarios';

export const PATCH = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const { id } = await params;
  await actualizarUsuario(obtenerDb(), ctx, id, await leerJson(req, esquemaCambiosUsuario));
  return json({ ok: true });
});
