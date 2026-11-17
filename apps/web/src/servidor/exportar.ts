/**
 * Exportación a CSV (módulo "Exportar", §10.1). Solo indicadores agregados: nunca textos de mensajes
 * ni datos de contactos. Cada exportación queda en auditoría.
 */
import type { EstadoSemaforo, Indicadores } from '@driven/core';
import type { Db } from '@driven/db';
import { exigirModulo, type ContextoAcceso } from './acceso';
import { auditar } from './auditoria';
import { solicitudInvalida } from './errores';
import { indicadoresSubcuenta, vistaGeneral } from './consultas/indicadores';

type Celda = string | number | null | undefined;

/** Evita que una hoja de cálculo interprete un texto como fórmula (inyección CSV). */
function celda(v: Celda): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 100) / 100) : '';
  const t = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** CSV con BOM (Excel lo abre en UTF-8), coma como separador y punto decimal. */
export function aCsv(filas: Celda[][]): string {
  return '﻿' + filas.map((f) => f.map(celda).join(',')).join('\r\n') + '\r\n';
}

const ESTADO: Record<EstadoSemaforo, string> = {
  verde: 'En meta',
  amarillo: 'Atención',
  rojo: 'Crítico',
};
const ETAPA: Record<string, string> = {
  atencion: 'Atención',
  seguimiento: 'Seguimiento',
  negociacion: 'Negociación',
  cierre: 'Cierre',
};

const CABECERA = [
  'Leads recibidos',
  'Tiempo de respuesta del asesor (min, mediana)',
  'Respuestas del asesor',
  'Respuestas ganadas por el agente IA',
  'Sin responder',
  'Pendientes de seguimiento',
  'Intentos por lead',
  'Respuesta efectiva (%)',
  'Calidad de mensajes (1-5)',
  'Conversión (%)',
  'Tiempo de cierre (días)',
  'Ventas',
  'Monto de ventas (S/)',
  'Ticket promedio (S/)',
  'Perdidos',
  'Atención',
  'Seguimiento',
  'Negociación',
  'Cierre',
  'Cuello de botella',
];

function valores(
  i: Indicadores,
  ev: { etapas: Record<string, EstadoSemaforo | null>; cuello: string | null },
): Celda[] {
  const e = (k: string) => (ev.etapas[k] ? ESTADO[ev.etapas[k]!] : 'Sin dato');
  return [
    i.leadsRecibidos,
    i.tiempoRespuestaMediana,
    i.respuestasAsesor,
    i.respuestasIa,
    i.sinResponder,
    i.seguimientoVencido,
    i.intentosPorLead,
    i.respuestaEfectivaPct,
    i.calidad,
    i.conversion,
    i.tiempoCierreDias,
    i.ventas,
    i.montoVentas,
    i.ticketPromedio,
    i.perdidos,
    e('atencion'),
    e('seguimiento'),
    e('negociacion'),
    e('cierre'),
    ev.cuello ? ETAPA[ev.cuello] : 'Ninguno',
  ];
}

export async function exportar(
  db: Db,
  ctx: ContextoAcceso,
  p: { tipo: string; subcuenta: string | null; desde: string; hasta: string },
) {
  exigirModulo(ctx, 'exportar', 'ver');
  let filas: Celda[][];
  let nombre: string;
  let subcuentas: string[];
  if (p.tipo === 'vista-general') {
    const v = await vistaGeneral(db, ctx, p.desde, p.hasta);
    subcuentas = v.subcuentas.map((s) => s.locationId);
    filas = [
      ['Subcuenta', ...CABECERA],
      ...v.subcuentas.map((s) => [s.nombre, ...valores(s.indicadores, s.evaluacion)]),
    ];
    if ('indicadores' in v && v.indicadores && 'evaluacion' in v && v.evaluacion)
      filas.push(['Total', ...valores(v.indicadores, v.evaluacion)]);
    nombre = `vista-general_${p.desde}_${p.hasta}.csv`;
  } else if (p.tipo === 'subcuenta' && p.subcuenta) {
    const s = await indicadoresSubcuenta(db, ctx, p.subcuenta, p.desde, p.hasta);
    subcuentas = [p.subcuenta];
    filas = [
      ['Asesor', ...CABECERA],
      ...[...s.asesores]
        .sort((a, b) => a.nombre.localeCompare(b.nombre))
        .map((a) => [a.nombre, ...valores(a.indicadores, a.evaluacion)]),
      [`Total ${s.subcuenta.nombre}`, ...valores(s.indicadores, s.evaluacion)],
    ];
    nombre = `${s.subcuenta.nombre.replace(/[^\p{L}\p{N}_-]+/gu, '-')}_${p.desde}_${p.hasta}.csv`;
  } else {
    throw solicitudInvalida('Tipo de exportación inválido.');
  }
  await auditar(db, ctx.usuarioId, 'exportacion', {
    tipo: p.tipo,
    subcuentas,
    desde: p.desde,
    hasta: p.hasta,
    filas: filas.length - 1,
  });
  return { nombre, csv: aCsv(filas) };
}
