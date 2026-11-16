import { esquemaEtapasAnalizador, etapasAnalizador } from '@/servidor/analizador';
import { obtenerDb } from '@/servidor/db';
import { solicitudInvalida } from '@/servidor/errores';
import { json, manejar, requerirSesion } from '@/servidor/http';

/**
 * Etapas seleccionables del analizador (todas las del pipeline), con los leads que hay hoy en cada
 * una. Parámetros: `subcuenta` y, opcionales, `creadosDesde` y `creadosHasta`.
 */
export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  const q = Object.fromEntries(new URL(req.url).searchParams);
  const r = esquemaEtapasAnalizador.safeParse(q);
  if (!r.success) throw solicitudInvalida(r.error.issues[0]?.message ?? 'Parámetros inválidos.');
  return json(await etapasAnalizador(obtenerDb(), ctx, r.data));
});
