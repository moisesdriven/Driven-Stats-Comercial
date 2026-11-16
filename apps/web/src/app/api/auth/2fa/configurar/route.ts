import { json, manejar, requerirSesion } from '@/servidor/http';
import { generarSecretoTotp, uriTotp } from '@/servidor/totp';

/** Genera un secreto nuevo. No se guarda hasta confirmarlo con un código válido. */
export const POST = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  const secreto = generarSecretoTotp();
  return json({ secreto, uri: uriTotp(secreto, ctx.correo) });
});
