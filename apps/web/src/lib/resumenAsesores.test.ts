import { describe, expect, it } from 'vitest';
import { filasResumen, type IndicadoresFila } from './resumenAsesores';

const fila = (c: Partial<IndicadoresFila>): IndicadoresFila => ({
  leadsRecibidos: 0,
  tiempoRespuestaMediana: null,
  sinResponder: 0,
  seguimientoVencido: 0,
  calidad: null,
  conversion: null,
  ventas: 0,
  ...c,
});

describe('filas de total y promedio de la tabla de asesores', () => {
  // El ejemplo de la captura del cliente (19 nov): 37 leads entre cuatro asesoras.
  const filas = [
    fila({
      leadsRecibidos: 10,
      tiempoRespuestaMediana: 3.9,
      sinResponder: 185,
      seguimientoVencido: 1532,
      calidad: 2.5,
      conversion: 0,
    }),
    fila({
      leadsRecibidos: 9,
      tiempoRespuestaMediana: 1.8,
      sinResponder: 140,
      seguimientoVencido: 1463,
      calidad: 2.5,
      conversion: 0,
    }),
    fila({
      leadsRecibidos: 9,
      tiempoRespuestaMediana: null,
      sinResponder: 32,
      seguimientoVencido: 1405,
      calidad: 2.2,
      conversion: 0,
    }),
    fila({
      leadsRecibidos: 9,
      tiempoRespuestaMediana: 5.1,
      sinResponder: 129,
      seguimientoVencido: 1573,
      calidad: 2.3,
      conversion: 0,
    }),
  ];

  it('el total suma las columnas contables y usa la mediana y la calidad del equipo', () => {
    const r = filasResumen(filas, { tiempoRespuestaMediana: 3.9, calidad: 2.4 })!;
    expect(r.total).toEqual({
      leadsRecibidos: 37,
      tiempoRespuestaMediana: 3.9,
      sinResponder: 486,
      seguimientoVencido: 5973,
      calidad: 2.4,
      conversion: 0,
      ventas: 0,
    });
  });

  it('el promedio divide entre los asesores y omite a quien no tiene dato', () => {
    const r = filasResumen(filas, { tiempoRespuestaMediana: 3.9, calidad: 2.4 })!;
    expect(r.promedio.leadsRecibidos).toBeCloseTo(9.25);
    expect(r.promedio.sinResponder).toBeCloseTo(121.5);
    expect(r.promedio.seguimientoVencido).toBeCloseTo(1493.25);
    // Leslie no tiene tiempo de respuesta: se promedian las otras tres (3,9 · 1,8 · 5,1).
    expect(r.promedio.tiempoRespuestaMediana).toBeCloseTo(3.6);
    expect(r.promedio.calidad).toBeCloseTo(2.375);
  });

  it('la conversión del total es ventas ÷ leads, no el promedio de conversiones', () => {
    const r = filasResumen(
      [
        fila({ leadsRecibidos: 90, ventas: 9, conversion: 10 }),
        fila({ leadsRecibidos: 10, ventas: 5, conversion: 50 }),
      ],
      { tiempoRespuestaMediana: null, calidad: null },
    )!;
    expect(r.total.conversion).toBeCloseTo(14);
    expect(r.promedio.conversion).toBeCloseTo(30);
  });

  it('sin asesores no hay filas', () => {
    expect(filasResumen([], { tiempoRespuestaMediana: null, calidad: null })).toBeNull();
  });
});
