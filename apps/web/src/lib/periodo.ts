/** Periodo elegido en los filtros (§10.2): hoy, últimos 7 días (por defecto), este mes o rango. */
import { fechaLocal } from '@driven/core';

export type ClavePeriodo = 'hoy' | '7d' | 'mes' | 'rango';

export interface Periodo {
  clave: ClavePeriodo;
  desde: string;
  hasta: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

const sumar = (iso: string, d: number) => {
  const [a, m, dd] = iso.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, dd + d)).toISOString().slice(0, 10);
};

export function leerPeriodo(
  params: Record<string, string | string[] | undefined>,
  zona = 'America/Lima',
  ahora = new Date(),
): Periodo {
  const v = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
  const hoy = fechaLocal(ahora, zona);
  const clave = (['hoy', '7d', 'mes', 'rango'] as const).find((c) => c === v('periodo')) ?? '7d';
  if (clave === 'hoy') return { clave, desde: hoy, hasta: hoy };
  if (clave === 'mes') return { clave, desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
  if (clave === 'rango') {
    const desde = v('desde');
    const hasta = v('hasta');
    if (desde && hasta && FECHA.test(desde) && FECHA.test(hasta) && desde <= hasta)
      return { clave, desde, hasta };
  }
  return { clave: '7d', desde: sumar(hoy, -6), hasta: hoy };
}

export function diasDelPeriodo(p: Periodo): string[] {
  const r: string[] = [];
  for (let d = p.desde; d <= p.hasta && r.length < 400; d = sumar(d, 1)) r.push(d);
  return r;
}

/** Query string para conservar el periodo al navegar. */
export function qsPeriodo(p: Periodo): string {
  return p.clave === 'rango'
    ? `?periodo=rango&desde=${p.desde}&hasta=${p.hasta}`
    : p.clave === '7d'
      ? ''
      : `?periodo=${p.clave}`;
}
