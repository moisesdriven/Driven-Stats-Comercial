/** Presentación del semáforo: siempre acompañado de texto, nunca solo color (§10.3). */
import type { EstadoSemaforo, EtapaProceso } from '@driven/core';

export type Tono = 'verde' | 'amarillo' | 'rojo' | 'azul' | 'gris';

export const tonoDe = (e: EstadoSemaforo | null | undefined): Tono => (e ? e : 'gris');

/** Texto corto del estado de un indicador. */
export function textoEstado(e: EstadoSemaforo | null | undefined): string {
  return e === 'verde'
    ? 'En meta'
    : e === 'amarillo'
      ? 'Cerca'
      : e === 'rojo'
        ? 'Crítico'
        : 'Sin dato';
}

export function textoEstadoEtapa(e: EstadoSemaforo | null | undefined): string {
  return e === 'verde'
    ? 'En meta'
    : e === 'amarillo'
      ? 'Atención'
      : e === 'rojo'
        ? 'Crítico'
        : 'Sin dato';
}

export function textoLeyenda(e: EstadoSemaforo | null | undefined): string {
  return e === 'verde'
    ? 'Cumple'
    : e === 'amarillo'
      ? 'Hasta 20 % debajo'
      : e === 'rojo'
        ? 'Más de 20 % debajo'
        : 'Sin dato';
}

export const COLORES: Record<Tono, string> = {
  verde: '#12B76A',
  amarillo: '#F79009',
  rojo: '#F04438',
  azul: '#1F5BFF',
  gris: '#B9C1D0',
};

export const NOMBRE_ETAPA: Record<EtapaProceso, string> = {
  atencion: 'Atención',
  seguimiento: 'Seguimiento',
  negociacion: 'Negociación',
  cierre: 'Cierre',
};

export const PREGUNTA_ETAPA: Record<EtapaProceso, string> = {
  atencion: '¿Responde a tiempo?',
  seguimiento: '¿Sigue a todos sus leads?',
  negociacion: '¿Sus mensajes convierten?',
  cierre: '¿Cierra en poco tiempo?',
};

export const ETAPAS_ORDEN: EtapaProceso[] = ['atencion', 'seguimiento', 'negociacion', 'cierre'];

export const TEXTO_ALERTA: Record<string, { titulo: string; detalle: string; tono: Tono }> = {
  vendeSinAtender: {
    titulo: 'Vende, pero deja escapar oportunidades',
    detalle: 'Ventas en meta y leads sin responder en rojo.',
    tono: 'rojo',
  },
  atiendeNoConvierte: {
    titulo: 'Atiende, pero no convierte',
    detalle: 'Revisar negociación o cierre.',
    tono: 'amarillo',
  },
  cierraLento: {
    titulo: 'Cierra, pero lento',
    detalle: 'Revisar productividad: el tiempo de cierre está en rojo.',
    tono: 'amarillo',
  },
  pierdePorSeguimiento: {
    titulo: 'Está perdiendo ventas por no hacer seguimiento',
    detalle: 'Seguimiento en rojo y leads perdidos por falta de seguimiento.',
    tono: 'rojo',
  },
};

/** Nombre visible de cada etapa estándar del pipeline. */
export const NOMBRE_ESTANDAR: Record<string, string> = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  interesado: 'Interesado',
  por_cerrar: 'Por cerrar',
  ganado: 'Ganado',
  perdido: 'Perdido',
};
