/**
 * Semáforo por indicador, estado por etapa, cuello de botella y alertas cruzadas (§5.3).
 */
import { ETAPAS_PROCESO, peorEstado, type EstadoSemaforo, type EtapaProceso } from './etapas';
import type { Indicadores } from './indicadores';

export interface Metas {
  tiempoRespuestaMin: number;
  sinResponder: { meta: 0; tolerancia: number };
  pendientes: { meta: 0; tolerancia: number };
  cumplimientoSeguimientoPct: number;
  intentosPorLead: number;
  perdidosFaltaSeguimiento: { meta: 0; tolerancia: number };
  calidad: number;
  respuestaEfectivaPct: number;
  abandonosPctMax: number;
  conversionPct: number;
  tiempoCierreDias: number;
  /** Sin valor por defecto: se pide al configurar la subcuenta. */
  ventasPorSemana: number | null;
  /** Tolerancia relativa para el amarillo (20 % por defecto). */
  toleranciaRelativa: number;
}

export const METAS_POR_DEFECTO: Metas = {
  tiempoRespuestaMin: 5,
  sinResponder: { meta: 0, tolerancia: 2 },
  pendientes: { meta: 0, tolerancia: 3 },
  cumplimientoSeguimientoPct: 80,
  intentosPorLead: 2,
  perdidosFaltaSeguimiento: { meta: 0, tolerancia: 2 },
  calidad: 3.5,
  respuestaEfectivaPct: 60,
  abandonosPctMax: 25,
  conversionPct: 12,
  tiempoCierreDias: 3,
  ventasPorSemana: null,
  toleranciaRelativa: 0.2,
};

/** Combina las metas guardadas de la subcuenta con las por defecto. */
export function metasDeSubcuenta(guardadas: unknown): Metas {
  return {
    ...METAS_POR_DEFECTO,
    ...(guardadas && typeof guardadas === 'object' ? (guardadas as Partial<Metas>) : {}),
  };
}

/** Margen para errores de coma flotante (p. ej. 9,6 / 12 = 0,7999…). */
const EPS = 1e-9;

/** Más es mejor: ratio = valor/meta. Verde ≥ 1; amarillo ≥ 1 − tolerancia; rojo debajo. */
export function semaforoMasEsMejor(valor: number, meta: number, tolerancia = 0.2): EstadoSemaforo {
  if (meta <= 0) return 'verde';
  const ratio = valor / meta;
  return ratio >= 1 - EPS ? 'verde' : ratio >= 1 - tolerancia - EPS ? 'amarillo' : 'rojo';
}

/** Menos es mejor: ratio = meta/valor (valor 0 = verde). */
export function semaforoMenosEsMejor(
  valor: number,
  meta: number,
  tolerancia = 0.2,
): EstadoSemaforo {
  if (valor <= 0) return 'verde';
  const ratio = meta / valor;
  return ratio >= 1 - EPS ? 'verde' : ratio >= 1 - tolerancia - EPS ? 'amarillo' : 'rojo';
}

/** Metas en cero: verde si 0; amarillo hasta la tolerancia absoluta; rojo si la supera. */
export function semaforoMetaCero(valor: number, tolerancia: number): EstadoSemaforo {
  return valor <= 0 ? 'verde' : valor <= tolerancia ? 'amarillo' : 'rojo';
}

export type ClaveIndicador =
  | 'tiempoRespuesta'
  | 'sinResponder'
  | 'cumplimientoSeguimiento'
  | 'pendientes'
  | 'intentosPorLead'
  | 'perdidosFaltaSeguimiento'
  | 'calidad'
  | 'respuestaEfectiva'
  | 'abandonos'
  | 'conversion'
  | 'tiempoCierre'
  | 'ventasVsMeta';

export const INDICADORES_POR_ETAPA: Record<EtapaProceso, ClaveIndicador[]> = {
  atencion: ['tiempoRespuesta', 'sinResponder'],
  seguimiento: [
    'cumplimientoSeguimiento',
    'pendientes',
    'intentosPorLead',
    'perdidosFaltaSeguimiento',
  ],
  negociacion: ['calidad', 'respuestaEfectiva', 'abandonos'],
  cierre: ['conversion', 'tiempoCierre', 'ventasVsMeta'],
};

/**
 * Estado de cada indicador con meta. `null` = sin dato o sin meta (no cuenta para el semáforo de la
 * etapa ni para el cuello de botella; p. ej. calidad "Sin análisis").
 */
export function evaluarIndicadores(
  i: Indicadores,
  m: Metas,
  diasDelPeriodo: number,
): Record<ClaveIndicador, EstadoSemaforo | null> {
  const t = m.toleranciaRelativa;
  const metaVentas = m.ventasPorSemana !== null ? (m.ventasPorSemana * diasDelPeriodo) / 7 : null;
  return {
    tiempoRespuesta:
      i.tiempoRespuestaMediana === null
        ? null
        : semaforoMenosEsMejor(i.tiempoRespuestaMediana, m.tiempoRespuestaMin, t),
    sinResponder: semaforoMetaCero(i.sinResponder, m.sinResponder.tolerancia),
    cumplimientoSeguimiento:
      i.cumplimientoSeguimientoPct === null
        ? null
        : semaforoMasEsMejor(i.cumplimientoSeguimientoPct, m.cumplimientoSeguimientoPct, t),
    pendientes: semaforoMetaCero(i.seguimientoVencido, m.pendientes.tolerancia),
    intentosPorLead:
      i.intentosPorLead === null
        ? null
        : semaforoMasEsMejor(i.intentosPorLead, m.intentosPorLead, t),
    perdidosFaltaSeguimiento: semaforoMetaCero(
      i.perdidosFaltaSeguimiento,
      m.perdidosFaltaSeguimiento.tolerancia,
    ),
    calidad: i.calidad === null ? null : semaforoMasEsMejor(i.calidad, m.calidad, t),
    respuestaEfectiva:
      i.respuestaEfectivaPct === null
        ? null
        : semaforoMasEsMejor(i.respuestaEfectivaPct, m.respuestaEfectivaPct, t),
    abandonos:
      i.abandonosPct === null ? null : semaforoMenosEsMejor(i.abandonosPct, m.abandonosPctMax, t),
    conversion: i.conversion === null ? null : semaforoMasEsMejor(i.conversion, m.conversionPct, t),
    tiempoCierre:
      i.tiempoCierreDias === null
        ? null
        : semaforoMenosEsMejor(i.tiempoCierreDias, m.tiempoCierreDias, t),
    ventasVsMeta: metaVentas === null ? null : semaforoMasEsMejor(i.ventas, metaVentas, t),
  };
}

/** Estado de una etapa = el peor estado entre sus indicadores con meta. */
export function estadosPorEtapa(
  estados: Record<ClaveIndicador, EstadoSemaforo | null>,
): Record<EtapaProceso, EstadoSemaforo | null> {
  const r = {} as Record<EtapaProceso, EstadoSemaforo | null>;
  for (const e of ETAPAS_PROCESO) {
    r[e] = peorEstado(
      INDICADORES_POR_ETAPA[e]
        .map((k) => estados[k])
        .filter((x): x is EstadoSemaforo => x !== null),
    );
  }
  return r;
}

/**
 * Cuello de botella = la etapa con peor estado; ante empate, la primera del proceso. Si todas están
 * en verde (o sin dato): `null` ("Sin cuello de botella").
 */
export function cuelloDeBotella(
  etapas: Record<EtapaProceso, EstadoSemaforo | null>,
): EtapaProceso | null {
  const gravedad = (e: EstadoSemaforo | null) => (e === 'rojo' ? 2 : e === 'amarillo' ? 1 : 0);
  let peor: EtapaProceso | null = null;
  for (const e of ETAPAS_PROCESO) {
    if (gravedad(etapas[e]) > 0 && (peor === null || gravedad(etapas[e]) > gravedad(etapas[peor])))
      peor = e;
  }
  return peor;
}

export const ALERTAS = {
  vendeSinAtender: 'Vende, pero deja escapar oportunidades',
  atiendeNoConvierte: 'Atiende, pero no convierte: revisar negociación o cierre',
  cierraLento: 'Cierra, pero lento: revisar productividad',
  pierdePorSeguimiento: 'Está perdiendo ventas por no hacer seguimiento',
} as const;

export function alertasCruzadas(
  estados: Record<ClaveIndicador, EstadoSemaforo | null>,
  etapas: Record<EtapaProceso, EstadoSemaforo | null>,
  i: Indicadores,
): (keyof typeof ALERTAS)[] {
  const r: (keyof typeof ALERTAS)[] = [];
  if (estados.ventasVsMeta === 'verde' && estados.sinResponder === 'rojo')
    r.push('vendeSinAtender');
  if (
    etapas.atencion === 'verde' &&
    (estados.conversion === 'amarillo' || estados.conversion === 'rojo')
  )
    r.push('atiendeNoConvierte');
  if (estados.conversion === 'verde' && estados.tiempoCierre === 'rojo') r.push('cierraLento');
  if (etapas.seguimiento === 'rojo' && i.perdidosFaltaSeguimiento > 0)
    r.push('pierdePorSeguimiento');
  return r;
}

/** Evaluación completa de un periodo. */
export function evaluar(i: Indicadores, m: Metas, diasDelPeriodo: number) {
  const estados = evaluarIndicadores(i, m, diasDelPeriodo);
  const etapas = estadosPorEtapa(estados);
  return {
    estados,
    etapas,
    cuello: cuelloDeBotella(etapas),
    alertas: alertasCruzadas(estados, etapas, i),
  };
}
