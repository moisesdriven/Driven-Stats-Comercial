/**
 * Periodo elegido en los filtros (§10.2): uno de los atajos del selector de fechas (últimos 7 días
 * por defecto) o un rango personalizado.
 */
import { fechaLocal } from '@driven/core';
import {
  esClavePeriodo,
  PERIODO_POR_DEFECTO,
  rangoDeAtajo,
  sumarDias,
  type ClavePeriodo,
} from './rangos';

export type { ClavePeriodo } from './rangos';

export interface Periodo {
  clave: ClavePeriodo;
  desde: string;
  hasta: string;
  /** Hoy en la zona horaria usada (el selector no deja elegir días futuros). */
  hoy: string;
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export function leerPeriodo(
  params: Record<string, string | string[] | undefined>,
  zona = 'America/Lima',
  ahora = new Date(),
): Periodo {
  const v = (k: string) => (typeof params[k] === 'string' ? (params[k] as string) : undefined);
  const hoy = fechaLocal(ahora, zona);
  const pedida = v('periodo');
  const clave: ClavePeriodo = esClavePeriodo(pedida) ? pedida : PERIODO_POR_DEFECTO;
  if (clave === 'rango') {
    const desde = v('desde');
    const hasta = v('hasta');
    if (desde && hasta && FECHA.test(desde) && FECHA.test(hasta) && desde <= hasta)
      return { clave, desde, hasta, hoy };
    return { clave: PERIODO_POR_DEFECTO, ...rangoDeAtajo(PERIODO_POR_DEFECTO, hoy), hoy };
  }
  return { clave, ...rangoDeAtajo(clave, hoy), hoy };
}

export function diasDelPeriodo(p: Pick<Periodo, 'desde' | 'hasta'>): string[] {
  const r: string[] = [];
  for (let d = p.desde; d <= p.hasta && r.length < 400; d = sumarDias(d, 1)) r.push(d);
  return r;
}

/** Query string para conservar el periodo al navegar. */
export function qsPeriodo(p: Pick<Periodo, 'clave' | 'desde' | 'hasta'>): string {
  return p.clave === 'rango'
    ? `?periodo=rango&desde=${p.desde}&hasta=${p.hasta}`
    : p.clave === PERIODO_POR_DEFECTO
      ? ''
      : `?periodo=${p.clave}`;
}
