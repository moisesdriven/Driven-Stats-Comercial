/**
 * Transiciones de una oportunidad entre dos lecturas (docs/mapeo-origen.md §5):
 * - Venta: `won` o entrada a una etapa mapeada como "ganado" (en Jade18K: Adelanto o posterior).
 * - Venta cancelada: una venta vigente que sale de "ganado" o termina perdida/abandonada.
 * - Pérdida: pasa a `lost` o `abandoned`. Reapertura: vuelve a `open` desde perdida.
 */
import type { EtapaEstandar } from './etapas';

export type EstadoOportunidad = 'open' | 'won' | 'lost' | 'abandoned';

export interface FotoOportunidad {
  status: EstadoOportunidad;
  stageId: string | null;
  etapaEstandar: EtapaEstandar | null;
}

export interface EstadoVenta {
  ventaEn: Date | null;
  ventaCanceladaEn: Date | null;
}

export type EventoOportunidad =
  | { tipo: 'cambio_etapa'; en: Date; desde: string | null; hacia: string | null }
  | { tipo: 'venta'; en: Date }
  | { tipo: 'venta_cancelada'; en: Date }
  | { tipo: 'perdida'; en: Date; etapa: string | null }
  | { tipo: 'reapertura'; en: Date };

export const esGanada = (f: FotoOportunidad) => f.status === 'won' || f.etapaEstandar === 'ganado';
export const esPerdida = (f: FotoOportunidad) => f.status === 'lost' || f.status === 'abandoned';
export const ventaVigente = (v: EstadoVenta) => v.ventaEn !== null && v.ventaCanceladaEn === null;

/**
 * Calcula los eventos entre la foto anterior (null si es nueva) y la actual.
 * `enEtapa` = fecha del cambio de etapa (lastStageChangeAt); `enEstado` = del cambio de estado.
 */
export function transicionesOportunidad(params: {
  anterior: FotoOportunidad | null;
  actual: FotoOportunidad;
  venta: EstadoVenta;
  enEtapa: Date;
  enEstado: Date;
}): { eventos: EventoOportunidad[]; venta: EstadoVenta } {
  const { anterior, actual, enEtapa, enEstado } = params;
  const eventos: EventoOportunidad[] = [];
  let venta = { ...params.venta };

  if (!anterior || anterior.stageId !== actual.stageId) {
    eventos.push({
      tipo: 'cambio_etapa',
      en: enEtapa,
      desde: anterior?.stageId ?? null,
      hacia: actual.stageId,
    });
  }
  if (esPerdida(actual) && (!anterior || !esPerdida(anterior))) {
    eventos.push({ tipo: 'perdida', en: enEstado, etapa: actual.stageId });
  }
  if (anterior && esPerdida(anterior) && actual.status === 'open') {
    eventos.push({ tipo: 'reapertura', en: enEstado });
  }

  const ganada = esGanada(actual) && !esPerdida(actual);
  if (ganada && !ventaVigente(venta)) {
    const en = actual.status === 'won' && actual.etapaEstandar !== 'ganado' ? enEstado : enEtapa;
    eventos.push({ tipo: 'venta', en });
    venta = { ventaEn: en, ventaCanceladaEn: null };
  } else if (!ganada && ventaVigente(venta)) {
    const en = esPerdida(actual) ? enEstado : enEtapa;
    eventos.push({ tipo: 'venta_cancelada', en });
    venta = { ...venta, ventaCanceladaEn: en };
  }
  return { eventos, venta };
}

/** Actividad de oportunidad leída de GHL (TYPE_ACTIVITY_OPPORTUNITY). */
export interface ActividadEtapa {
  opportunityId: string;
  en: Date;
  etapaAnterior: string | null;
  etapaNueva: string | null;
}

export interface IntervaloEtapa {
  opportunityId: string;
  etapa: string;
  desde: Date;
  hasta: Date | null;
}

/**
 * Reconstruye los intervalos de etapa de cada oportunidad a partir de sus actividades (por nombre de
 * etapa). La última etapa queda abierta (`hasta` nulo).
 */
export function intervalosDesdeActividades(
  actividades: readonly ActividadEtapa[],
): IntervaloEtapa[] {
  const porOportunidad = new Map<string, ActividadEtapa[]>();
  for (const a of actividades) {
    if (!a.etapaNueva) continue;
    const lista = porOportunidad.get(a.opportunityId) ?? [];
    lista.push(a);
    porOportunidad.set(a.opportunityId, lista);
  }
  const intervalos: IntervaloEtapa[] = [];
  for (const [opportunityId, lista] of porOportunidad) {
    lista.sort((x, y) => x.en.getTime() - y.en.getTime());
    let actual: IntervaloEtapa | null = null;
    for (const a of lista) {
      if (actual && actual.etapa === a.etapaNueva) continue;
      if (actual) actual.hasta = a.en;
      actual = { opportunityId, etapa: a.etapaNueva!, desde: a.en, hasta: null };
      intervalos.push(actual);
    }
  }
  return intervalos;
}
