import { describe, expect, it } from 'vitest';
import { leerPeriodo, qsPeriodo } from './periodo';
import { etiquetaPeriodo, rangoDeAtajo } from './rangos';

// Jueves 19 de noviembre de 2026.
const HOY = '2026-11-19';

describe('atajos del selector de fechas', () => {
  it.each([
    ['hoy', '2026-11-19', '2026-11-19'],
    ['ayer', '2026-11-18', '2026-11-18'],
    ['hoy_ayer', '2026-11-18', '2026-11-19'],
    ['7d', '2026-11-13', '2026-11-19'],
    ['14d', '2026-11-06', '2026-11-19'],
    ['28d', '2026-10-23', '2026-11-19'],
    ['30d', '2026-10-21', '2026-11-19'],
    ['semana', '2026-11-16', '2026-11-19'], // la semana empieza el lunes
    ['semana_pasada', '2026-11-09', '2026-11-15'],
    ['mes', '2026-11-01', '2026-11-19'],
    ['mes_pasado', '2026-10-01', '2026-10-31'],
  ] as const)('%s → %s a %s', (clave, desde, hasta) => {
    expect(rangoDeAtajo(clave, HOY)).toEqual({ desde, hasta });
  });

  it('un lunes, «esta semana» es solo hoy y «la semana pasada» la anterior completa', () => {
    expect(rangoDeAtajo('semana', '2026-11-16')).toEqual({
      desde: '2026-11-16',
      hasta: '2026-11-16',
    });
    expect(rangoDeAtajo('semana_pasada', '2026-11-16')).toEqual({
      desde: '2026-11-09',
      hasta: '2026-11-15',
    });
  });

  it('el mes pasado cruza el año en enero', () => {
    expect(rangoDeAtajo('mes_pasado', '2027-01-10')).toEqual({
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });
  });

  it('la etiqueta del botón lleva el atajo y las fechas', () => {
    expect(etiquetaPeriodo('30d', '2026-10-21', '2026-11-19')).toBe(
      'Últimos 30 días: 21 oct 2026 – 19 nov 2026',
    );
    expect(etiquetaPeriodo('hoy', HOY, HOY)).toBe('Hoy: 19 nov 2026');
  });
});

describe('periodo desde la URL', () => {
  const ahora = new Date('2026-11-19T15:00:00Z'); // 10:00 en Lima

  it('sin parámetro: últimos 7 días, y la URL no lo repite', () => {
    const p = leerPeriodo({}, 'America/Lima', ahora);
    expect(p).toEqual({ clave: '7d', desde: '2026-11-13', hasta: '2026-11-19', hoy: HOY });
    expect(qsPeriodo(p)).toBe('');
  });

  it('acepta los atajos nuevos y los de antes (hoy, mes, rango)', () => {
    expect(leerPeriodo({ periodo: 'mes_pasado' }, 'America/Lima', ahora)).toMatchObject({
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    expect(leerPeriodo({ periodo: 'mes' }, 'America/Lima', ahora).desde).toBe('2026-11-01');
    const r = leerPeriodo(
      { periodo: 'rango', desde: '2026-11-02', hasta: '2026-11-08' },
      'America/Lima',
      ahora,
    );
    expect(r).toMatchObject({ clave: 'rango', desde: '2026-11-02', hasta: '2026-11-08' });
    expect(qsPeriodo(r)).toBe('?periodo=rango&desde=2026-11-02&hasta=2026-11-08');
  });

  it('un rango inválido o un atajo desconocido vuelven a los últimos 7 días', () => {
    expect(
      leerPeriodo(
        { periodo: 'rango', desde: '2026-11-09', hasta: '2026-11-01' },
        'America/Lima',
        ahora,
      ).clave,
    ).toBe('7d');
    expect(leerPeriodo({ periodo: 'siempre' }, 'America/Lima', ahora).clave).toBe('7d');
  });
});
