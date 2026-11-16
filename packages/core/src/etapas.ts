/**
 * Las 4 etapas del proceso comercial (§5.3), en el orden en que se evalúan.
 * El orden importa: ante un empate en el cuello de botella gana la etapa más temprana.
 */
export const ETAPAS_PROCESO = ['atencion', 'seguimiento', 'negociacion', 'cierre'] as const;
export type EtapaProceso = (typeof ETAPAS_PROCESO)[number];

/** Etapas estándar del pipeline a las que se mapea cada etapa real de GHL (§3). */
export const ETAPAS_ESTANDAR = [
  'nuevo',
  'contactado',
  'interesado',
  'por_cerrar',
  'ganado',
  'perdido',
] as const;
export type EtapaEstandar = (typeof ETAPAS_ESTANDAR)[number];

/** Estado del semáforo. El orden va de mejor a peor. */
export const ESTADOS_SEMAFORO = ['verde', 'amarillo', 'rojo'] as const;
export type EstadoSemaforo = (typeof ESTADOS_SEMAFORO)[number];

/** Devuelve el peor de varios estados (verde < amarillo < rojo). Sin estados devuelve `null`. */
export function peorEstado(estados: readonly EstadoSemaforo[]): EstadoSemaforo | null {
  let peor: EstadoSemaforo | null = null;
  for (const e of estados) {
    if (peor === null || ESTADOS_SEMAFORO.indexOf(e) > ESTADOS_SEMAFORO.indexOf(peor)) peor = e;
  }
  return peor;
}
