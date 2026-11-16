import { z } from 'zod';
import { exigirAdmin } from '@/servidor/acceso';
import { reautenticar } from '@/servidor/autenticacion';
import { obtenerDb } from '@/servidor/db';
import { ErrorHttp } from '@/servidor/errores';
import { leerJson, manejar, requerirSesion } from '@/servidor/http';

const esquema = z.object({
  subcuentas: z.array(z.string().min(1)).min(1),
  desde: z.iso.date(),
  hasta: z.iso.date(),
  clave: z.string().max(200).optional(),
  codigo: z.string().max(10).optional(),
});

/**
 * Lanzar un análisis de calidad manual (§6.5): solo administradores y con revalidación.
 * La estimación de costo y el envío a la Batches API se implementan en la fase 4.
 */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  exigirAdmin(ctx);
  const datos = await leerJson(req, esquema);
  await reautenticar(obtenerDb(), ctx, datos);
  throw new ErrorHttp(501, 'El análisis de calidad se habilita en la fase 4.', 'no_implementado');
});
