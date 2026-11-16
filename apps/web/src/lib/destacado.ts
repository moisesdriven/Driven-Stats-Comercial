/**
 * Qué mostrar en la tarjeta de cada etapa: el indicador que explica su estado (el primero con el
 * peor semáforo, en el orden de la §5.3). Así una etapa "Crítico" nunca muestra un valor en meta.
 */
import {
  INDICADORES_POR_ETAPA,
  type ClaveIndicador,
  type EstadoSemaforo,
  type EtapaProceso,
  type Indicadores,
} from '@driven/core';
import { calidad, dias, minutos, numero, porcentaje } from './formato';

/** "1 intento" / "2,3 intentos" según el número ya formateado. */
const intentos = (v: number | null) => {
  const t = numero(v, 1);
  return `${t} ${t === '1' ? 'intento' : 'intentos'}`;
};

export interface Destacado {
  clave: ClaveIndicador;
  valor: string;
  etiqueta: string;
  meta: string;
  /** 0–100 para la barra de avance frente a la meta. */
  avance: number | null;
}

const gravedad = (e: EstadoSemaforo | null) =>
  e === 'rojo' ? 3 : e === 'amarillo' ? 2 : e === 'verde' ? 1 : 0;

export function describir(
  clave: ClaveIndicador,
  i: Indicadores,
  metaVentas: number | null,
): Destacado {
  const pctDe = (v: number | null, meta: number) =>
    v === null ? null : Math.max(0, Math.min(100, (v / meta) * 100));
  const pctInverso = (v: number | null, meta: number) =>
    v === null ? null : v <= 0 ? 100 : Math.max(0, Math.min(100, (meta / v) * 100));
  switch (clave) {
    case 'tiempoRespuesta':
      return {
        clave,
        valor: minutos(i.tiempoRespuestaMediana),
        etiqueta: 'Mediana de primera respuesta humana',
        meta: 'Meta 5 min laborales',
        avance: pctInverso(i.tiempoRespuestaMediana, 5),
      };
    case 'sinResponder':
      return {
        clave,
        valor: `${numero(i.sinResponder)} sin responder`,
        etiqueta: 'Leads sin respuesta de un asesor',
        meta: `Meta 0 · ${numero(i.enEspera)} en espera`,
        avance: i.sinResponder ? 0 : 100,
      };
    case 'cumplimientoSeguimiento':
      return {
        clave,
        valor: porcentaje(i.cumplimientoSeguimientoPct, 0),
        etiqueta: 'Interesados de días anteriores contactados hoy',
        meta: 'Meta 80 %',
        avance: pctDe(i.cumplimientoSeguimientoPct, 80),
      };
    case 'pendientes':
      return {
        clave,
        valor: `${numero(i.seguimientoVencido)} pendientes`,
        etiqueta: 'Seguimientos vencidos',
        meta: `Meta 0 · ${numero(i.seguimientoProgramado)} programados`,
        avance: i.seguimientoVencido ? 0 : 100,
      };
    case 'intentosPorLead':
      return {
        clave,
        valor: intentos(i.intentosPorLead),
        etiqueta: 'Intentos de contacto por lead',
        meta: 'Meta 2 o más',
        avance: pctDe(i.intentosPorLead, 2),
      };
    case 'perdidosFaltaSeguimiento':
      return {
        clave,
        valor: `${numero(i.perdidosFaltaSeguimiento)} perdidos`,
        etiqueta: 'Perdidos por falta de seguimiento',
        meta: 'Meta 0',
        avance: i.perdidosFaltaSeguimiento ? 0 : 100,
      };
    case 'calidad':
      return {
        clave,
        valor: calidad(i.calidad),
        etiqueta: 'Calidad promedio de mensajes',
        meta: 'Meta 3,5',
        avance: pctDe(i.calidad, 3.5),
      };
    case 'respuestaEfectiva':
      return {
        clave,
        valor: porcentaje(i.respuestaEfectivaPct, 0),
        etiqueta: 'Respuesta efectiva',
        meta: 'Meta 60 %',
        avance: pctDe(i.respuestaEfectivaPct, 60),
      };
    case 'abandonos':
      return {
        clave,
        valor: porcentaje(i.abandonosPct, 0),
        etiqueta: 'Clientes que abandonan',
        meta: 'Máximo 25 %',
        avance: pctInverso(i.abandonosPct, 25),
      };
    case 'conversion':
      return {
        clave,
        valor: porcentaje(i.conversion),
        etiqueta: 'Tasa de conversión',
        meta: 'Meta 12 %',
        avance: pctDe(i.conversion, 12),
      };
    case 'tiempoCierre':
      return {
        clave,
        valor: dias(i.tiempoCierreDias),
        etiqueta: 'Tiempo promedio de cierre',
        meta: 'Meta 3 días laborales',
        avance: pctInverso(i.tiempoCierreDias, 3),
      };
    case 'ventasVsMeta':
      return {
        clave,
        valor: `${numero(i.ventas)} ventas`,
        etiqueta: 'Ventas frente a la meta',
        meta:
          metaVentas === null
            ? 'Sin meta de ventas'
            : `Meta ${numero(metaVentas, 1)} en el periodo`,
        avance: metaVentas ? pctDe(i.ventas, metaVentas) : null,
      };
  }
}

/** El indicador que explica el estado de la etapa (o el principal si todos están en meta). */
export function destacadoEtapa(
  etapa: EtapaProceso,
  estados: Record<ClaveIndicador, EstadoSemaforo | null>,
  i: Indicadores,
  metaVentas: number | null = null,
): Destacado {
  const claves = INDICADORES_POR_ETAPA[etapa];
  let elegido = claves.find((k) => estados[k] !== null) ?? claves[0]!;
  for (const k of claves) if (gravedad(estados[k]) > gravedad(estados[elegido])) elegido = k;
  return describir(elegido, i, metaVentas);
}

/** El cuello de botella en una frase (detalle del asesor, §10.2). */
export function fraseCuello(d: Destacado, i: Indicadores): string {
  switch (d.clave) {
    case 'tiempoRespuesta':
      return `Tarda ${minutos(i.tiempoRespuestaMediana)} laborales en dar la primera respuesta`;
    case 'sinResponder':
      return `Deja ${numero(i.sinResponder)} leads sin respuesta de un asesor`;
    case 'cumplimientoSeguimiento':
      return `Solo ${porcentaje(i.cumplimientoSeguimientoPct, 0)} de sus interesados de días anteriores recibió contacto hoy`;
    case 'pendientes':
      return `Tiene ${numero(i.seguimientoVencido)} seguimientos vencidos`;
    case 'intentosPorLead':
      return `Hace ${intentos(i.intentosPorLead)} de contacto por lead`;
    case 'perdidosFaltaSeguimiento':
      return `Perdió ${numero(i.perdidosFaltaSeguimiento)} leads por falta de seguimiento`;
    case 'calidad':
      return `La calidad de sus mensajes es ${calidad(i.calidad)}`;
    case 'respuestaEfectiva':
      return `Solo ${porcentaje(i.respuestaEfectivaPct, 0)} de sus leads recibe una respuesta efectiva`;
    case 'abandonos':
      return `${porcentaje(i.abandonosPct, 0)} de sus clientes abandona la conversación`;
    case 'conversion':
      return `Convierte ${porcentaje(i.conversion)} de sus leads en ventas`;
    case 'tiempoCierre':
      return `Tarda ${dias(i.tiempoCierreDias)} laborales en cerrar una venta`;
    case 'ventasVsMeta':
      return `Concretó ${numero(i.ventas)} ventas en el periodo`;
  }
}
