/**
 * Filas al pie de la tabla de asesores (decisión del cliente del 19 nov 2026): «Total del equipo» y
 * «Promedio por asesor».
 *
 * - Total: leads, sin responder, pendientes y ventas se suman (coinciden con la tabla). El tiempo de
 *   respuesta y la calidad son los del equipo completo (mediana real de todas las respuestas y
 *   promedio ponderado del análisis, nunca promedio de promedios); la conversión es ventas ÷ leads.
 * - Promedio por asesor: cada columna dividida entre los asesores de la tabla. En tiempo de
 *   respuesta, calidad y conversión se promedian solo los asesores con dato.
 */
export interface IndicadoresFila {
  leadsRecibidos: number;
  tiempoRespuestaMediana: number | null;
  sinResponder: number;
  seguimientoVencido: number;
  calidad: number | null;
  conversion: number | null;
  ventas: number;
}

export interface ResumenEquipo {
  /** Mediana de respuesta del asesor de toda la subcuenta en el periodo. */
  tiempoRespuestaMediana: number | null;
  /** Calidad promedio de la subcuenta (último análisis). */
  calidad: number | null;
}

const suma = (xs: number[]) => xs.reduce((t, x) => t + x, 0);
const promedio = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? suma(v) / v.length : null;
};

export function filasResumen(
  filas: IndicadoresFila[],
  equipo: ResumenEquipo,
): { total: IndicadoresFila; promedio: IndicadoresFila } | null {
  const n = filas.length;
  if (!n) return null;
  const leads = suma(filas.map((f) => f.leadsRecibidos));
  const ventas = suma(filas.map((f) => f.ventas));
  const sinResponder = suma(filas.map((f) => f.sinResponder));
  const pendientes = suma(filas.map((f) => f.seguimientoVencido));
  return {
    total: {
      leadsRecibidos: leads,
      tiempoRespuestaMediana: equipo.tiempoRespuestaMediana,
      sinResponder,
      seguimientoVencido: pendientes,
      calidad: equipo.calidad,
      conversion: leads ? (ventas / leads) * 100 : null,
      ventas,
    },
    promedio: {
      leadsRecibidos: leads / n,
      tiempoRespuestaMediana: promedio(filas.map((f) => f.tiempoRespuestaMediana)),
      sinResponder: sinResponder / n,
      seguimientoVencido: pendientes / n,
      calidad: promedio(filas.map((f) => f.calidad)),
      conversion: promedio(filas.map((f) => f.conversion)),
      ventas: ventas / n,
    },
  };
}
