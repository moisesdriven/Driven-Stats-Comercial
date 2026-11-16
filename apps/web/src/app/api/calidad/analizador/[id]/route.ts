import { resultadoAnalizador } from '@/servidor/analizador';
import { obtenerDb } from '@/servidor/db';
import { solicitudInvalida } from '@/servidor/errores';
import { json, manejar, requerirSesion } from '@/servidor/http';

type Params = { params: Promise<{ id: string }> };

/** Resultado de un análisis del analizador a pedido (solo administradores). */
export const GET = manejar(async (req, { params }: Params) => {
  const { ctx } = await requerirSesion(req);
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) throw solicitudInvalida('Identificador inválido.');
  return json(await resultadoAnalizador(obtenerDb(), ctx, id));
});
