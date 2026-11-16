/**
 * Tiempo laboral por asesor (ESPECIFICACION.md §4). Todos los tiempos (respuesta, espera,
 * seguimiento, cierre) se miden en tiempo laboral, no en horas de reloj.
 *
 * - Horario por días de la semana con uno o más tramos y fechas de vigencia.
 * - Feriados (toda la subcuenta) y vacaciones o permisos (por asesor) no cuentan.
 * - Zona horaria de la subcuenta; correcto con cualquier zona, incluso con horario de verano.
 * Sin dependencias: las conversiones de zona usan Intl.
 */

export interface Tramo {
  /** 1 = lunes … 7 = domingo (ISO 8601). */
  diaSemana: number;
  /** "HH:MM" (24 h). */
  inicio: string;
  fin: string;
  /** "YYYY-MM-DD", inclusive. */
  vigenteDesde: string;
  vigenteHasta?: string | null;
}

export interface Ausencia {
  inicio: Date;
  fin: Date;
}

export type Horario = readonly Tramo[];

// ------------------------------------------------------------------ Zona horaria

const formateadores = new Map<string, Intl.DateTimeFormat>();
function formateador(zona: string): Intl.DateTimeFormat {
  let f = formateadores.get(zona);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zona,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formateadores.set(zona, f);
  }
  return f;
}

interface PartesLocales {
  anio: number;
  mes: number;
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
}

export function partesLocales(instante: Date, zona: string): PartesLocales {
  const p: Record<string, number> = {};
  for (const x of formateador(zona).formatToParts(instante)) {
    if (x.type !== 'literal') p[x.type] = Number(x.value);
  }
  return {
    anio: p.year!,
    mes: p.month!,
    dia: p.day!,
    hora: p.hour!,
    minuto: p.minute!,
    segundo: p.second!,
  };
}

/** Desfase de la zona respecto de UTC en ese instante, en ms. */
function desfase(instante: Date, zona: string): number {
  const p = partesLocales(instante, zona);
  const comoUtc = Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

/**
 * Instante UTC de una fecha y hora locales. Si la hora no existe (salto de horario de verano) se usa
 * el primer instante válido posterior; si se repite, la primera ocurrencia.
 */
export function instanteLocal(
  anio: number,
  mes: number,
  dia: number,
  hora: number,
  minuto: number,
  zona: string,
): Date {
  const pedido = Date.UTC(anio, mes - 1, dia, hora, minuto);
  let t = pedido - desfase(new Date(pedido), zona);
  t = pedido - desfase(new Date(t), zona);
  const pared = (x: number) => {
    const p = partesLocales(new Date(x), zona);
    return Date.UTC(p.anio, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  };
  if (pared(t) === pedido) {
    // Hora repetida (fin del horario de verano): se toma la primera ocurrencia.
    const antes = t - 3_600_000;
    return new Date(pared(antes) === pedido ? antes : t);
  }
  // Hora inexistente (salto): primer instante cuya hora local sea igual o posterior a la pedida.
  // Búsqueda binaria en segundos enteros: `bajo` siempre antes, `alto` siempre igual o después.
  let bajo = Math.floor((t - 3 * 3_600_000) / 1000);
  let alto = Math.ceil((t + 3 * 3_600_000) / 1000);
  while (alto - bajo > 1) {
    const medio = Math.floor((bajo + alto) / 2);
    if (pared(medio * 1000) >= pedido) alto = medio;
    else bajo = medio;
  }
  return new Date(alto * 1000);
}

const cacheFechas = new Map<string, string>();

/** Fecha local "YYYY-MM-DD" de un instante. */
export function fechaLocal(instante: Date, zona: string): string {
  // Las zonas cambian de desfase en horas o medias horas: basta cachear por cuarto de hora.
  const clave = `${zona}|${Math.floor(instante.getTime() / 900_000)}`;
  const c = cacheFechas.get(clave);
  if (c) return c;
  if (cacheFechas.size > 200_000) cacheFechas.clear();
  const r = fechaLocalSinCache(instante, zona);
  cacheFechas.set(clave, r);
  return r;
}

function fechaLocalSinCache(instante: Date, zona: string): string {
  const p = partesLocales(instante, zona);
  return `${p.anio}-${String(p.mes).padStart(2, '0')}-${String(p.dia).padStart(2, '0')}`;
}

/** Día de la semana ISO (1 = lunes) de una fecha "YYYY-MM-DD". */
function diaSemanaIso(fecha: string): number {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return dow === 0 ? 7 : dow;
}

function sumarDias(fecha: string, dias: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(a, m - 1, d + dias));
  return t.toISOString().slice(0, 10);
}

const aMinutos = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

// ------------------------------------------------------------------ Intervalos laborales

type Intervalo = [number, number];

/** Tramos vigentes en una fecha local (si dos vigencias se solapan, gana la más reciente). */
export function tramosDelDia(horario: Horario, fecha: string): Tramo[] {
  const vigentes = horario.filter(
    (t) => t.vigenteDesde <= fecha && (!t.vigenteHasta || t.vigenteHasta >= fecha),
  );
  if (!vigentes.length) return [];
  const desdeMasReciente = vigentes.reduce(
    (max, t) => (t.vigenteDesde > max ? t.vigenteDesde : max),
    '',
  );
  const dow = diaSemanaIso(fecha);
  return vigentes
    .filter((t) => t.vigenteDesde === desdeMasReciente && t.diaSemana === dow)
    .sort((a, b) => aMinutos(a.inicio) - aMinutos(b.inicio));
}

/** Caché por horario: los intervalos de un día solo dependen del horario, la fecha y la zona. */
const cacheIntervalos = new WeakMap<Horario, Map<string, Intervalo[]>>();

/** Intervalos laborales (ms UTC) de una fecha local, sin restar ausencias. */
function intervalosDelDia(horario: Horario, fecha: string, zona: string): Intervalo[] {
  let porDia = cacheIntervalos.get(horario);
  if (!porDia) {
    porDia = new Map();
    cacheIntervalos.set(horario, porDia);
  }
  const clave = `${zona}|${fecha}`;
  let r = porDia.get(clave);
  if (!r) {
    r = calcularIntervalosDelDia(horario, fecha, zona);
    porDia.set(clave, r);
  }
  return r;
}

function calcularIntervalosDelDia(horario: Horario, fecha: string, zona: string): Intervalo[] {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return tramosDelDia(horario, fecha).map((t) => {
    const ini = aMinutos(t.inicio);
    const fin = aMinutos(t.fin);
    return [
      instanteLocal(a, m, d, Math.floor(ini / 60), ini % 60, zona).getTime(),
      fin >= 24 * 60
        ? instanteLocal(a, m, d + 1, 0, 0, zona).getTime()
        : instanteLocal(a, m, d, Math.floor(fin / 60), fin % 60, zona).getTime(),
    ] as Intervalo;
  });
}

/** Resta las ausencias a un conjunto de intervalos. */
function restar(intervalos: Intervalo[], ausencias: readonly Ausencia[]): Intervalo[] {
  let resultado = intervalos;
  for (const au of ausencias) {
    const ai = au.inicio.getTime();
    const af = au.fin.getTime();
    const siguiente: Intervalo[] = [];
    for (const [i, f] of resultado) {
      if (af <= i || ai >= f) {
        siguiente.push([i, f]);
        continue;
      }
      if (ai > i) siguiente.push([i, ai]);
      if (af < f) siguiente.push([af, f]);
    }
    resultado = siguiente;
  }
  return resultado;
}

const MAX_DIAS = 800;

/** Intervalos laborales efectivos (con ausencias restadas) de una fecha local. */
function laboralesDelDia(
  horario: Horario,
  ausencias: readonly Ausencia[],
  fecha: string,
  zona: string,
): Intervalo[] {
  return restar(intervalosDelDia(horario, fecha, zona), ausencias);
}

// ------------------------------------------------------------------ API pública

/** Minutos laborales entre dos instantes (0 si fin ≤ inicio). */
export function minutosLaborales(
  inicio: Date,
  fin: Date,
  horario: Horario,
  ausencias: readonly Ausencia[],
  zona: string,
): number {
  const a = inicio.getTime();
  const b = fin.getTime();
  if (b <= a) return 0;
  let fecha = sumarDias(fechaLocal(inicio, zona), -1);
  const ultima = sumarDias(fechaLocal(fin, zona), 1);
  let total = 0;
  for (let n = 0; fecha <= ultima && n < MAX_DIAS; n++, fecha = sumarDias(fecha, 1)) {
    for (const [i, f] of laboralesDelDia(horario, ausencias, fecha, zona)) {
      const desde = Math.max(i, a);
      const hasta = Math.min(f, b);
      if (hasta > desde) total += hasta - desde;
    }
  }
  return total / 60_000;
}

/**
 * Instante en que se cumplen `minutos` laborales desde `inicio` (p. ej. el vencimiento de "1 día
 * laboral"). Con 0 minutos devuelve el inicio del siguiente tramo laboral (o el mismo instante si ya
 * está dentro de uno). Devuelve `null` si no hay tiempo laboral en el horizonte (horario vacío).
 */
export function sumarTiempoLaboral(
  inicio: Date,
  minutos: number,
  horario: Horario,
  ausencias: readonly Ausencia[],
  zona: string,
): Date | null {
  let restante = minutos * 60_000;
  const a = inicio.getTime();
  let fecha = sumarDias(fechaLocal(inicio, zona), -1);
  for (let n = 0; n < MAX_DIAS; n++, fecha = sumarDias(fecha, 1)) {
    for (const [i, f] of laboralesDelDia(horario, ausencias, fecha, zona)) {
      const desde = Math.max(i, a);
      if (f <= desde) continue;
      if (restante <= f - desde) return new Date(desde + restante);
      restante -= f - desde;
    }
  }
  return null;
}

/** Duración de la jornada (minutos) de una fecha local según el horario, sin ausencias. */
export function minutosJornada(horario: Horario, fecha: string, zona: string): number {
  return intervalosDelDia(horario, fecha, zona).reduce((s, [i, f]) => s + (f - i), 0) / 60_000;
}

/**
 * Días laborales entre dos instantes: cada día aporta (minutos laborales trabajados ese día ÷ duración
 * de la jornada de ese día). 1 día laboral = la jornada de ese asesor en ese día.
 */
export function diasLaborales(
  inicio: Date,
  fin: Date,
  horario: Horario,
  ausencias: readonly Ausencia[],
  zona: string,
): number {
  const a = inicio.getTime();
  const b = fin.getTime();
  if (b <= a) return 0;
  let fecha = sumarDias(fechaLocal(inicio, zona), -1);
  const ultima = sumarDias(fechaLocal(fin, zona), 1);
  let dias = 0;
  for (let n = 0; fecha <= ultima && n < MAX_DIAS; n++, fecha = sumarDias(fecha, 1)) {
    const jornada = minutosJornada(horario, fecha, zona);
    if (!jornada) continue;
    let trabajado = 0;
    for (const [i, f] of laboralesDelDia(horario, ausencias, fecha, zona)) {
      const desde = Math.max(i, a);
      const hasta = Math.min(f, b);
      if (hasta > desde) trabajado += hasta - desde;
    }
    dias += trabajado / 60_000 / jornada;
  }
  return dias;
}

/** ¿El instante cae dentro del horario laboral (y fuera de ausencias)? */
export function enHorarioLaboral(
  instante: Date,
  horario: Horario,
  ausencias: readonly Ausencia[],
  zona: string,
): boolean {
  const t = instante.getTime();
  const fecha = fechaLocal(instante, zona);
  return laboralesDelDia(horario, ausencias, fecha, zona).some(([i, f]) => t >= i && t < f);
}

// ------------------------------------------------------------------ Modo de tiempo por subcuenta

/**
 * Cómo se miden los tiempos de una subcuenta:
 * - `laboral` (por defecto): solo dentro del horario de cada asesor, sin feriados ni ausencias.
 * - `corrido`: tiempo de reloj las 24 horas, todos los días (para equipos con horarios variables).
 */
export type ModoTiempo = 'laboral' | 'corrido';

/** Configuración de tiempo guardada en la subcuenta (`subcuentas.horario_general`). */
export interface ConfiguracionTiempo {
  modo: ModoTiempo;
  /** Fecha local desde la que el worker debe recalcular el resumen diario (pendiente). */
  recalcularDesde: string | null;
}

export function configuracionTiempo(guardada: unknown): ConfiguracionTiempo {
  const g = (guardada && typeof guardada === 'object' ? guardada : {}) as Record<string, unknown>;
  return {
    modo: g.modo === 'corrido' ? 'corrido' : 'laboral',
    recalcularDesde:
      typeof g.recalcularDesde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.recalcularDesde)
        ? g.recalcularDesde
        : null,
  };
}

/** Horario de 24 horas los 7 días: con él, el tiempo "laboral" es el tiempo de reloj. */
export const HORARIO_CORRIDO: Horario = Object.freeze(
  [1, 2, 3, 4, 5, 6, 7].map((diaSemana) => ({
    diaSemana,
    inicio: '00:00',
    fin: '24:00',
    vigenteDesde: '2000-01-01',
    vigenteHasta: null,
  })),
);
