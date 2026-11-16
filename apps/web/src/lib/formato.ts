/** Formatos en español (Perú) para la interfaz. Puros: sirven en servidor y cliente. */

/** Coma decimal y punto de miles, como en el diseño aprobado ("5,8 min", "1.000"). */
const num = (decimales: number) =>
  new Intl.NumberFormat('es-ES', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimales,
    useGrouping: 'always',
  });

export const SIN_DATO = '—';

export function numero(v: number | null | undefined, decimales = 0): string {
  return v === null || v === undefined || Number.isNaN(v) ? SIN_DATO : num(decimales).format(v);
}

/** 5,8 min · 2 h 10 min · 3 días (para tiempos laborales en minutos). */
export function minutos(v: number | null | undefined): string {
  if (v === null || v === undefined) return SIN_DATO;
  if (v < 60) return `${num(1).format(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

export function porcentaje(v: number | null | undefined, decimales = 1): string {
  return v === null || v === undefined ? SIN_DATO : `${num(decimales).format(v)} %`;
}

export function dias(v: number | null | undefined): string {
  if (v === null || v === undefined) return SIN_DATO;
  return `${num(1).format(v)} ${Math.abs(v - 1) < 0.05 ? 'día' : 'días'}`;
}

export function soles(v: number | null | undefined): string {
  if (v === null || v === undefined) return SIN_DATO;
  return `S/ ${num(0).format(v)}`;
}

export function calidad(v: number | null | undefined): string {
  return v === null || v === undefined ? 'Sin análisis' : `${num(1).format(v)} / 5`;
}

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];
const DIAS_CORTOS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const partes = (iso: string) => {
  const [a, m, d] = iso.split('-').map(Number) as [number, number, number];
  return { a, m, d, dow: new Date(Date.UTC(a, m - 1, d)).getUTCDay() };
};

/** "del 8 al 14 de noviembre" · "el 16 de noviembre" · "del 28 de octubre al 3 de noviembre". */
export function rangoFechas(desde: string, hasta: string): string {
  const a = partes(desde);
  const b = partes(hasta);
  if (desde === hasta) return `el ${a.d} de ${MESES[a.m - 1]}`;
  if (a.m === b.m && a.a === b.a) return `del ${a.d} al ${b.d} de ${MESES[b.m - 1]}`;
  return `del ${a.d} de ${MESES[a.m - 1]} al ${b.d} de ${MESES[b.m - 1]}`;
}

export function fechaLarga(iso: string): string {
  const p = partes(iso.slice(0, 10));
  return `${p.d} de ${MESES[p.m - 1]} de ${p.a}`;
}

/** "Lun 9" para el eje de un gráfico diario. */
export function diaCorto(iso: string): string {
  const p = partes(iso);
  return `${DIAS_CORTOS[p.dow]} ${p.d}`;
}

export function mesAnio(iso: string): string {
  const p = partes(iso);
  return `${MESES[p.m - 1]} ${p.a}`;
}

/** "Hace 6 min", "Hoy, 09:05", "Ayer, 19:12", "12 de noviembre", "Nunca". */
export function haceCuanto(
  fecha: string | Date | null | undefined,
  ahora = new Date(),
  zona = 'America/Lima',
): string {
  if (!fecha) return 'Nunca';
  const f = new Date(fecha);
  const min = Math.round((ahora.getTime() - f.getTime()) / 60_000);
  if (min < 1) return 'Hace un momento';
  if (min < 60) return `Hace ${min} min`;
  const fmt = new Intl.DateTimeFormat('es-PE', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const dia = (x: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: zona }).format(x);
  if (dia(f) === dia(ahora)) return `Hoy, ${fmt.format(f)}`;
  if (dia(f) === dia(new Date(ahora.getTime() - 86_400_000))) return `Ayer, ${fmt.format(f)}`;
  return fechaLarga(dia(f));
}

export function iniciales(nombre: string | null | undefined): string {
  const palabras = (nombre ?? '?').trim().split(/\s+/).filter(Boolean);
  return (
    (palabras[0]?.[0] ?? '?') +
    (palabras.length > 1 ? palabras[palabras.length - 1]![0] : (palabras[0]?.[1] ?? ''))
  ).toUpperCase();
}

/** Nombre corto para tablas: primeras dos palabras con mayúscula inicial. */
export function nombreCorto(nombre: string | null | undefined): string {
  return (nombre ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(' ');
}
