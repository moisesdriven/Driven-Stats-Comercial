import { json, manejar, requerirSesion } from '@/servidor/http';

/** Datos del usuario actual y sus permisos efectivos (para armar el menú). */
export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req, { permitirCambioPendiente: true });
  return json({
    id: ctx.usuarioId,
    correo: ctx.correo,
    nombre: ctx.nombre,
    rol: ctx.rol,
    subcuentas: ctx.subcuentas,
    modulos: ctx.modulos,
    totpActivo: ctx.totpActivo,
    debeCambiarClave: ctx.debeCambiarClave,
  });
});
