import { solicitudInvalida } from './errores';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Lee `desde` y `hasta` (YYYY-MM-DD) de la URL. Por defecto, los últimos 7 días. */
export function leerRango(req: Request): { desde: string; hasta: string } {
  const url = new URL(req.url);
  const hoy = new Date();
  const hace7 = new Date(hoy.getTime() - 6 * 86_400_000);
  const desde = url.searchParams.get('desde') ?? hace7.toISOString().slice(0, 10);
  const hasta = url.searchParams.get('hasta') ?? hoy.toISOString().slice(0, 10);
  if (!FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) {
    throw solicitudInvalida('Rango de fechas inválido.');
  }
  return { desde, hasta };
}
