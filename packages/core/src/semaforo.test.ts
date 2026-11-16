import { describe, expect, it } from 'vitest';
import { acumuladoVacio, calcularIndicadores, type Indicadores } from './indicadores';
import {
  METAS_POR_DEFECTO as M,
  alertasCruzadas,
  cuelloDeBotella,
  estadosPorEtapa,
  evaluar,
  evaluarIndicadores,
  metasDeSubcuenta,
  semaforoMasEsMejor,
  semaforoMenosEsMejor,
  semaforoMetaCero,
} from './semaforo';

describe('semáforo por indicador', () => {
  it('más es mejor: verde ≥ meta, amarillo hasta 20 % debajo, rojo más abajo', () => {
    expect(semaforoMasEsMejor(12, 12)).toBe('verde');
    expect(semaforoMasEsMejor(9.6, 12)).toBe('amarillo');
    expect(semaforoMasEsMejor(9.5, 12)).toBe('rojo');
  });

  it('menos es mejor: ratio = meta/valor; valor 0 es verde', () => {
    expect(semaforoMenosEsMejor(5, 5)).toBe('verde');
    expect(semaforoMenosEsMejor(6, 5)).toBe('amarillo');
    expect(semaforoMenosEsMejor(7, 5)).toBe('rojo');
    expect(semaforoMenosEsMejor(0, 5)).toBe('verde');
  });

  it('metas en cero con tolerancia absoluta', () => {
    expect(semaforoMetaCero(0, 2)).toBe('verde');
    expect(semaforoMetaCero(2, 2)).toBe('amarillo');
    expect(semaforoMetaCero(3, 2)).toBe('rojo');
  });

  it('la tolerancia relativa es configurable', () => {
    expect(semaforoMasEsMejor(8.5, 10, 0.1)).toBe('rojo');
  });
});

const base = (cambios: Partial<Indicadores>): Indicadores => ({
  ...calcularIndicadores(acumuladoVacio(), 7),
  tiempoRespuestaMediana: 3,
  cumplimientoSeguimientoPct: 90,
  intentosPorLead: 2.5,
  respuestaEfectivaPct: 70,
  abandonosPct: 10,
  conversion: 15,
  tiempoCierreDias: 2,
  ...cambios,
});

describe('etapas y cuello de botella', () => {
  it('sin calidad ni meta de ventas, esos indicadores no cuentan', () => {
    const e = evaluarIndicadores(base({}), M, 7);
    expect(e.calidad).toBeNull();
    expect(e.ventasVsMeta).toBeNull();
    expect(estadosPorEtapa(e).negociacion).toBe('verde');
  });

  it('todo en verde: sin cuello de botella', () => {
    expect(evaluar(base({}), M, 7).cuello).toBeNull();
  });

  it('el estado de la etapa es el peor de sus indicadores', () => {
    const e = evaluarIndicadores(base({ seguimientoVencido: 2, intentosPorLead: 1 }), M, 7);
    const etapas = estadosPorEtapa(e);
    expect(e.pendientes).toBe('amarillo');
    expect(etapas.seguimiento).toBe('rojo');
  });

  it('ante empate gana la etapa más temprana del proceso', () => {
    expect(
      cuelloDeBotella({
        atencion: 'amarillo',
        seguimiento: 'rojo',
        negociacion: 'rojo',
        cierre: 'verde',
      }),
    ).toBe('seguimiento');
    expect(
      cuelloDeBotella({
        atencion: 'rojo',
        seguimiento: 'rojo',
        negociacion: 'verde',
        cierre: 'rojo',
      }),
    ).toBe('atencion');
  });

  it('la meta semanal de ventas se ajusta a los días del periodo', () => {
    const m = metasDeSubcuenta({ ventasPorSemana: 7 });
    expect(evaluarIndicadores(base({ ventas: 3 }), m, 3).ventasVsMeta).toBe('verde');
    expect(evaluarIndicadores(base({ ventas: 2 }), m, 3).ventasVsMeta).toBe('rojo');
  });
});

describe('alertas cruzadas', () => {
  const m = metasDeSubcuenta({ ventasPorSemana: 5 });

  it('vende, pero deja escapar oportunidades', () => {
    const r = evaluar(base({ ventas: 10, sinResponder: 9 }), m, 7);
    expect(r.alertas).toContain('vendeSinAtender');
  });

  it('atiende, pero no convierte', () => {
    expect(evaluar(base({ conversion: 9 }), m, 7).alertas).toContain('atiendeNoConvierte');
  });

  it('cierra, pero lento', () => {
    expect(evaluar(base({ tiempoCierreDias: 6 }), m, 7).alertas).toContain('cierraLento');
  });

  it('pierde ventas por no hacer seguimiento', () => {
    const i = base({ cumplimientoSeguimientoPct: 30, perdidosFaltaSeguimiento: 4 });
    const e = evaluarIndicadores(i, m, 7);
    expect(alertasCruzadas(e, estadosPorEtapa(e), i)).toContain('pierdePorSeguimiento');
  });

  it('sin problemas no hay alertas', () => {
    expect(evaluar(base({ ventas: 10 }), m, 7).alertas).toEqual([]);
  });
});
