import { obtenerDb } from '@/servidor/db';
import { exportar } from '@/servidor/exportar';
import { manejar, requerirSesion } from '@/servidor/http';
import { leerCanal } from '@/lib/canales';
import { leerRango } from '@/servidor/rango';

/** Descarga en CSV de la vista general o de una subcuenta (indicadores agregados). */
export const GET = manejar(async (req) => {
  const { ctx } = await requerirSesion(req);
  const url = new URL(req.url);
  const { desde, hasta } = leerRango(req);
  const r = await exportar(obtenerDb(), ctx, {
    tipo: url.searchParams.get('tipo') ?? '',
    subcuenta: url.searchParams.get('subcuenta'),
    canal: leerCanal(Object.fromEntries(url.searchParams)),
    desde,
    hasta,
  });
  return new Response(r.csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${encodeURIComponent(r.nombre)}"; filename*=UTF-8''${encodeURIComponent(r.nombre)}`,
      'cache-control': 'no-store',
    },
  });
});
