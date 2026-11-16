/**
 * Métricas por lead y agregación de los 8 indicadores (ESPECIFICACION.md §3 y §5) con las
 * decisiones del cliente (docs/mapeo-origen.md §5):
 * - Solo los mensajes `manual` cuentan como atención del asesor.
 * - Reglas del cliente (16 nov 2026): los mensajes de entrada al CRM ("Headline" o "*Headline*") no
 *   cuentan; mientras el lead está en la etapa Nuevo (lo atiende el workflow) sus mensajes no se miden;
 *   se mide cada mensaje del cliente que responde el asesor, desde el primero sin responder; si el
 *   agente IA responde antes, cuenta como respuesta ganada por la IA; "sin responder" es un mensaje
 *   que no respondió ni el asesor ni el agente IA.
 * - Un lead perdido sale de las listas operativas (sin responder, en espera, pendientes,
 *   interesados) y se cuenta en leads perdidos; sigue contando como recibido para la conversión.
 * - Seguimiento vencido (requiere acción) frente a programado (tarea futura).
 */
import {
  diasLaborales,
  fechaLocal,
  instanteLocal,
  minutosLaborales,
  partesLocales,
  type Ausencia,
  type Horario,
} from './horario';
import type { Origen } from './origen';

export interface Umbrales {
  /** SLA de primera respuesta humana para "respuesta efectiva" (min laborales). */
  slaRespuestaMin: number;
  /** Lead atendido "en espera": último mensaje del cliente sin respuesta humana (min laborales). */
  esperaMin: number;
  /** Seguimiento vencido: días laborales sin saliente humano en Interesado/Por cerrar. */
  seguimientoDias: number;
  /** Abandono: horas sin respuesta del cliente tras el último saliente. */
  abandonoHoras: number;
  /** Separación mínima (min laborales) entre dos bloques de salientes para contar intentos distintos. */
  separacionIntentoMin: number;
  /** Perdido por falta de seguimiento: menos de N intentos tras quedar en silencio. */
  intentosMinimosTrasSilencio: number;
}

export const UMBRALES_POR_DEFECTO: Umbrales = {
  slaRespuestaMin: 5,
  esperaMin: 15,
  seguimientoDias: 1,
  abandonoHoras: 72,
  separacionIntentoMin: 60,
  intentosMinimosTrasSilencio: 2,
};

export interface MensajeLead {
  fecha: Date;
  direccion: 'inbound' | 'outbound';
  origen: Origen | null;
  /** Mensaje de entrada al CRM ("Headline: …"): no es un mensaje del cliente y no se cuenta. */
  entrada?: boolean;
}

/** Patrón de los mensajes de entrada al CRM: empiezan con "Headline" o "*Headline*". */
export const PATRON_MENSAJE_ENTRADA = /^\s*\*?headline/i;
/** El mismo patrón para PostgreSQL (operador `~*`). */
export const PATRON_MENSAJE_ENTRADA_SQL = '^\\s*\\*?headline';

export function esMensajeDeEntrada(texto: string | null | undefined): boolean {
  return texto ? PATRON_MENSAJE_ENTRADA.test(texto) : false;
}

/** Periodo en que el lead estuvo en la etapa estándar Nuevo (`hasta` nulo = sigue ahí). */
export interface PeriodoEtapa {
  desde: Date;
  hasta: Date | null;
}

/** Una respuesta del asesor: cuándo escribió el cliente (primer mensaje sin responder) y cuánto tardó. */
export interface RespuestaAsesor {
  clienteEn: Date;
  minutos: number;
}

export interface TareaLead {
  venceEn: Date | null;
  completada: boolean;
}

export interface DatosLead {
  ingresoEn: Date;
  /** Mensajes del contacto (cualquier orden). */
  mensajes: readonly MensajeLead[];
  estado: 'abierto' | 'ganado' | 'perdido';
  etapaEstandar: string | null;
  ventaEn: Date | null;
  tareas?: readonly TareaLead[];
  /** Periodos en la etapa Nuevo (historial de etapas). Sin historial, cuenta la etapa actual. */
  periodosNuevo?: readonly PeriodoEtapa[];
}

export interface TiempoAsesor {
  horario: Horario;
  ausencias: readonly Ausencia[];
  zona: string;
}

export interface MetricasLead {
  /** Tiempo de la primera respuesta del asesor (min laborales); null si no respondió. */
  minutosRespuesta: number | null;
  /** Cada mensaje del cliente respondido por el asesor (el tiempo corre desde el primero sin responder). */
  respuestasAsesor: RespuestaAsesor[];
  /** Mensajes del cliente que el agente IA respondió antes que el asesor (fecha del mensaje del cliente). */
  ganadasIa: Date[];
  /** Primer mensaje del cliente aún sin respuesta del asesor ni del agente IA. */
  pendienteDesde: Date | null;
  primeraHumanaEn: Date | null;
  sinResponder: boolean;
  enEspera: boolean;
  intentos: number;
  respuestaEfectiva: boolean;
  abandono: boolean;
  seguimientoVencido: boolean;
  seguimientoProgramado: boolean;
  perdidoPorFaltaSeguimiento: boolean;
  interesadoDiasAnteriores: boolean;
  contactadoHoy: boolean;
  diasCierre: number | null;
}

const ETAPAS_SEGUIMIENTO = new Set(['interesado', 'por_cerrar']);

/** Inicio del día local (00:00) del instante dado. */
export function inicioDelDia(instante: Date, zona: string): Date {
  const p = partesLocales(instante, zona);
  return instanteLocal(p.anio, p.mes, p.dia, 0, 0, zona);
}

/**
 * Bloques de salientes humanos (intentos de contacto): un bloque nuevo empieza tras un mensaje del
 * cliente o cuando pasan al menos `separacionIntentoMin` minutos laborales desde el saliente anterior.
 */
export function bloquesDeIntentos(
  mensajes: readonly MensajeLead[],
  t: TiempoAsesor,
  u: Umbrales,
): Date[] {
  const inicios: Date[] = [];
  let ultimoHumano: Date | null = null;
  let huboClienteDesde = true;
  for (const m of mensajes) {
    if (m.direccion === 'inbound') {
      huboClienteDesde = true;
      continue;
    }
    if (m.origen !== 'manual') continue;
    const separado =
      !ultimoHumano ||
      minutosLaborales(ultimoHumano, m.fecha, t.horario, t.ausencias, t.zona) >=
        u.separacionIntentoMin;
    if (huboClienteDesde || separado) inicios.push(m.fecha);
    ultimoHumano = m.fecha;
    huboClienteDesde = false;
  }
  return inicios;
}

/** Calcula las métricas de un lead tal como están en el instante `ahora`. */
export function metricasLead(
  d: DatosLead,
  t: TiempoAsesor,
  u: Umbrales,
  ahora: Date,
): MetricasLead {
  // Los mensajes de entrada al CRM ("Headline") no son mensajes del cliente: no se cuentan.
  // A igual hora, primero el mensaje del cliente: una respuesta automática puede llevar el mismo segundo.
  const mensajes = d.mensajes
    .filter((m) => m.fecha <= ahora && !m.entrada)
    .sort(
      (a, b) =>
        a.fecha.getTime() - b.fecha.getTime() ||
        (a.direccion === b.direccion ? 0 : a.direccion === 'inbound' ? -1 : 1),
    );
  const desdeIngreso = mensajes.filter((m) => m.fecha >= d.ingresoEn);
  const humanos = desdeIngreso.filter((m) => m.direccion === 'outbound' && m.origen === 'manual');
  const entrantes = mensajes.filter((m) => m.direccion === 'inbound');
  const primeraHumana = humanos[0]?.fecha ?? null;
  const ultimoHumano = humanos.at(-1)?.fecha ?? null;
  const ultimoEntrante = entrantes.at(-1)?.fecha ?? null;
  const ultimo = mensajes.at(-1) ?? null;
  const perdido = d.estado === 'perdido';
  const abierto = d.estado === 'abierto';
  const vendido = d.ventaEn !== null && d.ventaEn <= ahora;
  const minLab = (a: Date, b: Date) => minutosLaborales(a, b, t.horario, t.ausencias, t.zona);

  // Respuestas: cada mensaje medible del cliente abre una espera (si no había una) que cierra la
  // primera respuesta del asesor (se mide) o del agente IA (ganada por la IA). Los workflows y las
  // campañas no cuentan como respuesta. En la etapa Nuevo los mensajes del cliente no se miden.
  const periodos = d.periodosNuevo ?? [];
  const enNuevo = (f: Date) =>
    periodos.length
      ? periodos.some((p) => f >= p.desde && (p.hasta === null || f < p.hasta))
      : d.etapaEstandar === 'nuevo';
  const respuestasAsesor: RespuestaAsesor[] = [];
  const ganadasIa: Date[] = [];
  let pendienteDesde: Date | null = null;
  let huboRespuesta = false;
  for (const m of desdeIngreso) {
    if (m.direccion === 'inbound') {
      if (!pendienteDesde && !enNuevo(m.fecha)) pendienteDesde = m.fecha;
      continue;
    }
    if (m.origen !== 'manual' && m.origen !== 'agente_ia') continue;
    if (pendienteDesde) {
      if (m.origen === 'manual')
        respuestasAsesor.push({
          clienteEn: pendienteDesde,
          minutos: minLab(pendienteDesde, m.fecha),
        });
      else ganadasIa.push(pendienteDesde);
      pendienteDesde = null;
    }
    huboRespuesta = true;
  }
  const minutosRespuesta = respuestasAsesor[0]?.minutos ?? null;
  const intentosInicios = bloquesDeIntentos(desdeIngreso, t, u);

  const respuestaEfectiva =
    minutosRespuesta !== null &&
    minutosRespuesta <= u.slaRespuestaMin &&
    entrantes.some((m) => primeraHumana !== null && m.fecha > primeraHumana);

  const abandono =
    !vendido &&
    ultimo !== null &&
    ultimo.direccion === 'outbound' &&
    ahora.getTime() - ultimo.fecha.getTime() >= u.abandonoHoras * 3_600_000;

  // Sin responder: un mensaje del cliente que no respondió ni el asesor ni el agente IA, fuera de la
  // etapa Nuevo. "En espera" es el subconjunto que ya venía conversando y lleva más de N minutos.
  const sinResponder = !perdido && pendienteDesde !== null && d.etapaEstandar !== 'nuevo';
  const enEspera = sinResponder && huboRespuesta && minLab(pendienteDesde!, ahora) > u.esperaMin;

  const enSeguimiento =
    abierto && d.etapaEstandar !== null && ETAPAS_SEGUIMIENTO.has(d.etapaEstandar);
  const tareasAbiertas = (d.tareas ?? []).filter((x) => !x.completada && x.venceEn);
  const tareaVencida = tareasAbiertas.some((x) => x.venceEn! < ahora);
  const tareaFutura = tareasAbiertas.some((x) => x.venceEn! >= ahora);
  const referencia = ultimoHumano ?? d.ingresoEn;
  const sinContactoMucho =
    diasLaborales(referencia, ahora, t.horario, t.ausencias, t.zona) > u.seguimientoDias;
  const seguimientoVencido = enSeguimiento && (tareaVencida || sinContactoMucho);
  const seguimientoProgramado = enSeguimiento && !seguimientoVencido && tareaFutura;

  const silencioDesde = ultimoEntrante;
  const intentosTrasSilencio = silencioDesde
    ? intentosInicios.filter((x) => x > silencioDesde).length
    : intentosInicios.length;
  const ultimoFueCliente = ultimo?.direccion === 'inbound';
  const perdidoPorFaltaSeguimiento =
    (perdido || abandono) &&
    !vendido &&
    (ultimoFueCliente || intentosTrasSilencio < u.intentosMinimosTrasSilencio);

  const hoy = inicioDelDia(ahora, t.zona);
  const contactoAntesDeHoy = mensajes
    .filter((m) => m.fecha < hoy && (m.direccion === 'inbound' || m.origen === 'manual'))
    .at(-1);
  const interesadoDiasAnteriores =
    enSeguimiento && contactoAntesDeHoy !== undefined && d.ingresoEn < hoy;
  const contactadoHoy = humanos.some((m) => m.fecha >= hoy);

  return {
    minutosRespuesta,
    respuestasAsesor,
    ganadasIa,
    pendienteDesde,
    primeraHumanaEn: primeraHumana,
    sinResponder,
    enEspera,
    intentos: intentosInicios.length,
    respuestaEfectiva,
    abandono,
    seguimientoVencido,
    seguimientoProgramado,
    perdidoPorFaltaSeguimiento,
    interesadoDiasAnteriores,
    contactadoHoy,
    diasCierre:
      vendido && d.ventaEn
        ? diasLaborales(d.ingresoEn, d.ventaEn, t.horario, t.ausencias, t.zona)
        : null,
  };
}

// ------------------------------------------------------------------ Acumulados sumables

/**
 * Acumulado diario por asesor (o por subcuenta). Todos los campos se pueden SUMAR entre días,
 * asesores y subcuentas: la vista general nunca promedia promedios (§8).
 * Los campos `foto*` son el estado al cierre del día (o ahora, para hoy): al agregar un periodo se
 * toma la foto del último día.
 */
export interface Acumulado {
  leadsRecibidos: number;
  /** Minutos laborales de cada respuesta del asesor a mensajes del cliente escritos ese día. */
  tiemposRespuesta: number[];
  /** Mensajes del cliente de ese día que el agente IA respondió antes que el asesor. */
  respuestasIa: number;
  leadsConRespuesta: number;
  respuestasEfectivas: number;
  abandonos: number;
  intentosTotal: number;
  /** Distribución de intentos de los leads recibidos: [0, 1, 2, 3+]. */
  intentosDistribucion: [number, number, number, number];
  ventas: number;
  montoVentas: number;
  sumaDiasCierre: number;
  ventasConDiasCierre: number;
  /** Ventas de los leads recibidos ese día (conversión por cohorte). */
  ventasCohorte: number;
  ventasCanceladas: number;
  perdidos: number;
  perdidosPorMotivo: Record<string, number>;
  perdidosFaltaSeguimiento: number;
  fotoSinResponder: number;
  fotoEnEspera: number;
  fotoSeguimientoVencido: number;
  fotoSeguimientoProgramado: number;
  fotoInteresadosAnteriores: number;
  fotoInteresadosContactadosHoy: number;
}

export function acumuladoVacio(): Acumulado {
  return {
    leadsRecibidos: 0,
    tiemposRespuesta: [],
    respuestasIa: 0,
    leadsConRespuesta: 0,
    respuestasEfectivas: 0,
    abandonos: 0,
    intentosTotal: 0,
    intentosDistribucion: [0, 0, 0, 0],
    ventas: 0,
    montoVentas: 0,
    sumaDiasCierre: 0,
    ventasConDiasCierre: 0,
    ventasCohorte: 0,
    ventasCanceladas: 0,
    perdidos: 0,
    perdidosPorMotivo: {},
    perdidosFaltaSeguimiento: 0,
    fotoSinResponder: 0,
    fotoEnEspera: 0,
    fotoSeguimientoVencido: 0,
    fotoSeguimientoProgramado: 0,
    fotoInteresadosAnteriores: 0,
    fotoInteresadosContactadosHoy: 0,
  };
}

const CAMPOS_FOTO = [
  'fotoSinResponder',
  'fotoEnEspera',
  'fotoSeguimientoVencido',
  'fotoSeguimientoProgramado',
  'fotoInteresadosAnteriores',
  'fotoInteresadosContactadosHoy',
] as const;

/** Suma acumulados del mismo día (p. ej. varios asesores o varias subcuentas). */
export function sumarAcumulados(lista: readonly Acumulado[]): Acumulado {
  const r = acumuladoVacio();
  for (const a of lista) {
    r.leadsRecibidos += a.leadsRecibidos;
    r.tiemposRespuesta.push(...a.tiemposRespuesta);
    r.respuestasIa += a.respuestasIa ?? 0;
    r.leadsConRespuesta += a.leadsConRespuesta;
    r.respuestasEfectivas += a.respuestasEfectivas;
    r.abandonos += a.abandonos;
    r.intentosTotal += a.intentosTotal;
    for (let i = 0; i < 4; i++) r.intentosDistribucion[i]! += a.intentosDistribucion[i]!;
    r.ventas += a.ventas;
    r.montoVentas += a.montoVentas;
    r.sumaDiasCierre += a.sumaDiasCierre;
    r.ventasConDiasCierre += a.ventasConDiasCierre;
    r.ventasCohorte += a.ventasCohorte;
    r.ventasCanceladas += a.ventasCanceladas;
    r.perdidos += a.perdidos;
    for (const [k, v] of Object.entries(a.perdidosPorMotivo))
      r.perdidosPorMotivo[k] = (r.perdidosPorMotivo[k] ?? 0) + v;
    r.perdidosFaltaSeguimiento += a.perdidosFaltaSeguimiento;
    for (const c of CAMPOS_FOTO) r[c] += a[c];
  }
  return r;
}

/**
 * Agrega un periodo: suma los días y toma las fotos del último día. `dias` debe venir ordenado por
 * fecha ascendente (un acumulado por día, ya sumado entre asesores o subcuentas si corresponde).
 */
export function agregarPeriodo(dias: readonly Acumulado[]): Acumulado {
  const r = sumarAcumulados(dias);
  const ultimo = dias.at(-1);
  for (const c of CAMPOS_FOTO) r[c] = ultimo ? ultimo[c] : 0;
  return r;
}

export function mediana(valores: readonly number[]): number | null {
  if (!valores.length) return null;
  const v = [...valores].sort((a, b) => a - b);
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m]! : (v[m - 1]! + v[m]!) / 2;
}

const pct = (a: number, b: number) => (b ? (a / b) * 100 : null);
const div = (a: number, b: number) => (b ? a / b : null);

/** Los 8 indicadores y las respuestas a las 12 preguntas (§5.1 y §5.2) para un periodo. */
export interface Indicadores {
  leadsRecibidos: number;
  tiempoRespuestaMediana: number | null;
  tiempoRespuestaPromedio: number | null;
  /** Respuestas del asesor medidas en el periodo. */
  respuestasAsesor: number;
  /** Respuestas que ganó el agente IA (respondió antes que el asesor). */
  respuestasIa: number;
  /** % de las respuestas que ganó el agente IA. */
  respuestasIaPct: number | null;
  /** Indicador 2: lo completa el último análisis de calidad (fase 4); null = "Sin análisis". */
  calidad: number | null;
  sinResponder: number;
  enEspera: number;
  seguimientoVencido: number;
  seguimientoProgramado: number;
  conversion: number | null;
  conversionCohorte: number | null;
  tiempoCierreDias: number | null;
  ticketPromedio: number | null;
  ventas: number;
  montoVentas: number;
  ventasPorDia: number | null;
  ventasCanceladas: number;
  perdidos: number;
  perdidosPorMotivo: Record<string, number>;
  perdidosFaltaSeguimiento: number;
  intentosPorLead: number | null;
  intentosDistribucion: [number, number, number, number];
  abandonos: number;
  abandonosPct: number | null;
  respuestaEfectivaPct: number | null;
  cumplimientoSeguimientoPct: number | null;
  interesadosAnteriores: number;
}

export function calcularIndicadores(
  a: Acumulado,
  diasDelPeriodo: number,
  calidad: number | null = null,
): Indicadores {
  return {
    leadsRecibidos: a.leadsRecibidos,
    tiempoRespuestaMediana: mediana(a.tiemposRespuesta),
    tiempoRespuestaPromedio: div(
      a.tiemposRespuesta.reduce((s, x) => s + x, 0),
      a.tiemposRespuesta.length,
    ),
    respuestasAsesor: a.tiemposRespuesta.length,
    respuestasIa: a.respuestasIa ?? 0,
    respuestasIaPct: pct(a.respuestasIa ?? 0, a.tiemposRespuesta.length + (a.respuestasIa ?? 0)),
    calidad,
    sinResponder: a.fotoSinResponder,
    enEspera: a.fotoEnEspera,
    seguimientoVencido: a.fotoSeguimientoVencido,
    seguimientoProgramado: a.fotoSeguimientoProgramado,
    conversion: pct(a.ventas, a.leadsRecibidos),
    conversionCohorte: pct(a.ventasCohorte, a.leadsRecibidos),
    tiempoCierreDias: div(a.sumaDiasCierre, a.ventasConDiasCierre),
    ticketPromedio: div(a.montoVentas, a.ventas),
    ventas: a.ventas,
    montoVentas: a.montoVentas,
    ventasPorDia: div(a.ventas, diasDelPeriodo),
    ventasCanceladas: a.ventasCanceladas,
    perdidos: a.perdidos,
    perdidosPorMotivo: a.perdidosPorMotivo,
    perdidosFaltaSeguimiento: a.perdidosFaltaSeguimiento,
    intentosPorLead: div(a.intentosTotal, a.leadsRecibidos),
    intentosDistribucion: a.intentosDistribucion,
    abandonos: a.abandonos,
    abandonosPct: pct(a.abandonos, a.leadsRecibidos),
    respuestaEfectivaPct: pct(a.respuestasEfectivas, a.leadsRecibidos),
    cumplimientoSeguimientoPct: pct(a.fotoInteresadosContactadosHoy, a.fotoInteresadosAnteriores),
    interesadosAnteriores: a.fotoInteresadosAnteriores,
  };
}

/** Fecha local "YYYY-MM-DD" para agrupar por día en la zona de la subcuenta. */
export const diaLocal = fechaLocal;
