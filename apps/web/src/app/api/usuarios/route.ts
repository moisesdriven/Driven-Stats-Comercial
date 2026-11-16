import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';
import { crearUsuario, esquemaNuevoUsuario, listarUsuarios } from '@/servidor/usuarios';

export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  return json({ usuarios: await listarUsuarios(obtenerDb(), ctx) });
});

export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaNuevoUsuario);
  const r = await crearUsuario(obtenerDb(), ctx, datos);
  // La contraseña temporal se muestra una sola vez al administrador.
  return json(r, 201);
});
