/**
 * Atajos del selector de fechas (pedido del cliente del 19 nov 2026) y sus rangos. Sin dependencias:
 * lo usan el servidor (`leerPeriodo`) y el selector del navegador. Fechas ISO (AAAA-MM-DD) en la
 * zona horaria de la subcuenta; la semana empieza el lunes.
 */
export const ATAJOS = [
  { clave: 'hoy', texto: 'Hoy' },
  { clave: 'ayer', texto: 'Ayer' },
  { clave: 'hoy_ayer', texto: 'Hoy y ayer' },
  { clave: '7d', texto: 'Últimos 7 días' },
  { clave: '14d', texto: 'Últimos 14 días' },
  { clave: '28d', texto: 'Últimos 28 días' },
  { clave: '30d', texto: 'Últimos 30 días' },
  { clave: 'semana', texto: 'Esta semana' },
  { clave: 'semana_pasada', texto: 'La semana pasada' },
  { clave: 'mes', texto: 'Este mes' },
  { clave: 'mes_pasado', texto: 'El mes pasado' },
  { clave: 'rango', texto: 'Personalizado' },
] as const;

export type ClavePeriodo = (typeof ATAJOS)[number]['clave'];

/** Periodo por defecto (sin parámetro en la URL). */
export const PERIODO_POR_DEFECTO = '7d' satisfies ClavePeriodo;

export const esClavePeriodo = (v: unknown): v is ClavePeriodo => ATAJOS.some((a) => a.clave === v);

export const textoAtajo = (c: ClavePeriodo) => ATAJOS.find((a) => a.clave === c)!.texto;

const partes = (iso: string) => iso.split('-').map(Number) as [number, number, number];

export function sumarDias(iso: string, d: number): string {
  const [a, m, dd] = partes(iso);
  return new Date(Date.UTC(a, m - 1, dd + d)).toISOString().slice(0, 10);
}

/** Lunes = 0 … domingo = 6. */
export function diaSemana(iso: string): number {
  const [a, m, d] = partes(iso);
  return (new Date(Date.UTC(a, m - 1, d)).getUTCDay() + 6) % 7;
}

export function inicioMes(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

export function finMes(iso: string): string {
  const [a, m] = partes(iso);
  return new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
}

/** Rango de un atajo respecto de `hoy`. `rango` (personalizado) no tiene rango propio. */
export function rangoDeAtajo(
  clave: Exclude<ClavePeriodo, 'rango'>,
  hoy: string,
): { desde: string; hasta: string } {
  switch (clave) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'ayer': {
      const ayer = sumarDias(hoy, -1);
      return { desde: ayer, hasta: ayer };
    }
    case 'hoy_ayer':
      return { desde: sumarDias(hoy, -1), hasta: hoy };
    case '7d':
      return { desde: sumarDias(hoy, -6), hasta: hoy };
    case '14d':
      return { desde: sumarDias(hoy, -13), hasta: hoy };
    case '28d':
      return { desde: sumarDias(hoy, -27), hasta: hoy };
    case '30d':
      return { desde: sumarDias(hoy, -29), hasta: hoy };
    case 'semana':
      return { desde: sumarDias(hoy, -diaSemana(hoy)), hasta: hoy };
    case 'semana_pasada': {
      const lunes = sumarDias(hoy, -diaSemana(hoy) - 7);
      return { desde: lunes, hasta: sumarDias(lunes, 6) };
    }
    case 'mes':
      return { desde: inicioMes(hoy), hasta: hoy };
    case 'mes_pasado': {
      const fin = sumarDias(inicioMes(hoy), -1);
      return { desde: inicioMes(fin), hasta: fin };
    }
  }
}

const MESES_CORTOS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];

/** 13 nov 2026 */
export function fechaCorta(iso: string): string {
  const [a, m, d] = partes(iso);
  return `${d} ${MESES_CORTOS[m - 1]} ${a}`;
}

/** «Últimos 7 días: 13 nov 2026 – 19 nov 2026» (o una sola fecha si el rango es de un día). */
export function etiquetaPeriodo(clave: ClavePeriodo, desde: string, hasta: string): string {
  const fechas =
    desde === hasta ? fechaCorta(desde) : `${fechaCorta(desde)} – ${fechaCorta(hasta)}`;
  return `${textoAtajo(clave)}: ${fechas}`;
}
