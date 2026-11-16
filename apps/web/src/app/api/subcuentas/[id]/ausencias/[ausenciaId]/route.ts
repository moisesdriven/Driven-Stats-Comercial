import { obtenerDb } from '@/servidor/db';
import { solicitudInvalida } from '@/servidor/errores';
import { eliminarAusencia } from '@/servidor/horarios';
import { json, manejar, requerirSesion } from '@/servidor/http';

export const DELETE = manejar(
  async (req, { params }: { params: Promise<{ id: string; ausenciaId: string }> }) => {
    const { ctx } = await requerirSesion(req);
    const { id, ausenciaId } = await params;
    const n = Number(ausenciaId);
    if (!Number.isInteger(n)) throw solicitudInvalida('Id de ausencia inválido.');
    return json(await eliminarAusencia(obtenerDb(), ctx, id, n));
  },
);
