import {
  darDeAltaSubcuenta,
  esquemaAltaSubcuenta,
  estadoSubcuentas,
} from '@/servidor/configuracion';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json({ subcuentas: await estadoSubcuentas(obtenerDb(), ctx) });
});

/** Alta asistida: verifica los permisos del PIT antes de guardarlo (cifrado). */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaAltaSubcuenta);
  return json(await darDeAltaSubcuenta(obtenerDb(), ctx, datos), 201);
});
