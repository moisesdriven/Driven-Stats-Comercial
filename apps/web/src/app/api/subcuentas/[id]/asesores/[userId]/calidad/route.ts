import { ejemplosAsesor } from '@/servidor/calidad';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';

/** Mejor y peor mensaje del asesor en el último análisis (panel de "Calidad de mensajes"). */
export const GET = manejar(
  async (req, { params }: { params: Promise<{ id: string; userId: string }> }) => {
    const { ctx } = await requerirSesion(req);
    const { id, userId } = await params;
    return json(await ejemplosAsesor(obtenerDb(), ctx, id, userId));
  },
);
