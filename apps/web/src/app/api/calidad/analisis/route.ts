import { z } from 'zod';
import { exigirAdmin } from '@/servidor/acceso';
import { reautenticar } from '@/servidor/autenticacion';
import { esquemaPeriodo, historialCalidad, lanzarAnalisis } from '@/servidor/calidad';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

const esquema = esquemaPeriodo.extend({
  clave: z.string().max(200).optional(),
  codigo: z.string().max(10).optional(),
});

export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json(await historialCalidad(obtenerDb(), ctx));
});

/** Lanzar un análisis manual (§6.5): solo administradores y con contraseña o código 2FA. */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  exigirAdmin(ctx);
  const datos = await leerJson(req, esquema);
  const db = obtenerDb();
  await reautenticar(db, ctx, datos);
  return json(
    await lanzarAnalisis(db, ctx, {
      subcuentas: datos.subcuentas,
      desde: datos.desde,
      hasta: datos.hasta,
    }),
    202,
  );
});
