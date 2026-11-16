import { describe, expect, it } from 'vitest';
import {
  configuracionTiempo,
  diasLaborales,
  HORARIO_CORRIDO,
  minutosLaborales,
  sumarTiempoLaboral,
} from './horario';

const d = (s: string) => new Date(s);

describe('tiempo corrido (24/7)', () => {
  it('cuenta el tiempo de reloj, incluidas noches y domingos', () => {
    // Sábado 21:30 → domingo 08:40 en Lima.
    expect(
      minutosLaborales(
        d('2026-11-14T21:30:00-05:00'),
        d('2026-11-15T08:40:00-05:00'),
        HORARIO_CORRIDO,
        [],
        'America/Lima',
      ),
    ).toBe(670);
  });

  it('un día laboral equivale a 24 horas', () => {
    expect(
      diasLaborales(
        d('2026-11-10T10:00:00-05:00'),
        d('2026-11-13T22:00:00-05:00'),
        HORARIO_CORRIDO,
        [],
        'America/Lima',
      ),
    ).toBeCloseTo(3.5, 5);
  });

  it('sumar tiempo no salta noches', () => {
    expect(
      sumarTiempoLaboral(
        d('2026-11-10T23:30:00-05:00'),
        60,
        HORARIO_CORRIDO,
        [],
        'America/Lima',
      )?.toISOString(),
    ).toBe('2026-11-11T05:30:00.000Z');
  });

  it('funciona también en zonas con horario de verano', () => {
    // Cambio de hora en Nueva York (1 de noviembre de 2026): de 00:00 a 06:00 locales hay 7 horas reales.
    expect(
      minutosLaborales(
        d('2026-11-01T04:00:00Z'),
        d('2026-11-01T11:00:00Z'),
        HORARIO_CORRIDO,
        [],
        'America/New_York',
      ),
    ).toBe(420);
  });
});

describe('configuración de tiempo de la subcuenta', () => {
  it('por defecto es laboral y descarta valores inválidos', () => {
    expect(configuracionTiempo(null)).toEqual({ modo: 'laboral', recalcularDesde: null });
    expect(configuracionTiempo({ modo: 'otro', recalcularDesde: 'ayer' })).toEqual({
      modo: 'laboral',
      recalcularDesde: null,
    });
    expect(configuracionTiempo({ modo: 'corrido', recalcularDesde: '2026-09-01' })).toEqual({
      modo: 'corrido',
      recalcularDesde: '2026-09-01',
    });
  });
});
