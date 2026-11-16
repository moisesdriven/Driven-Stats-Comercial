import { z } from 'zod';
import { exigirAdmin } from '@/servidor/acceso';
import { esquemaAnalizador, lanzarAnalizador } from '@/servidor/analizador';
import { reautenticar } from '@/servidor/autenticacion';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

const esquema = esquemaAnalizador.extend({
  clave: z.string().max(200).optional(),
  codigo: z.string().max(10).optional(),
});

/** Lanzar el analizador a pedido: solo administradores y con contraseña o código 2FA. */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  exigirAdmin(ctx);
  const { clave, codigo, ...datos } = await leerJson(req, esquema);
  const db = obtenerDb();
  await reautenticar(db, ctx, { clave, codigo });
  return json(await lanzarAnalizador(db, ctx, datos), 202);
});
