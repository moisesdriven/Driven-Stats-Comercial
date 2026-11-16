import { indicadoresAsesor } from '@/servidor/consultas/indicadores';
import { obtenerDb } from '@/servidor/db';
import { json, manejar, requerirSesion } from '@/servidor/http';
import { leerRango } from '@/servidor/rango';

export const GET = manejar(
  async (req, { params }: { params: Promise<{ id: string; userId: string }> }) => {
    const { ctx } = await requerirSesion(req);
    const { id, userId } = await params;
    const { desde, hasta } = leerRango(req);
    return json(await indicadoresAsesor(obtenerDb(), ctx, id, userId, desde, hasta));
  },
);
