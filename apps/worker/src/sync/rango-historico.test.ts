import { describe, expect, it } from 'vitest';
import { DIAS_HISTORICO, inicioHistorico } from './ejecutar';

describe('rango de la carga histórica (los 90 días anteriores, hoy incluido)', () => {
  it('empieza a medianoche, hora de la subcuenta, 89 días antes de hoy', () => {
    // 20 nov 2026, 10:00 en Lima → desde el 23 ago 2026 a las 00:00 de Lima (05:00 UTC).
    const ahora = new Date('2026-11-20T15:00:00Z');
    expect(DIAS_HISTORICO).toBe(90);
    expect(inicioHistorico(ahora, 'America/Lima').toISOString()).toBe('2026-08-23T05:00:00.000Z');
  });

  it('a las 23:00 de Lima (ya otro día en UTC) cuenta el día de Lima', () => {
    const ahora = new Date('2026-11-21T04:00:00Z'); // 20 nov, 23:00 en Lima
    expect(inicioHistorico(ahora, 'America/Lima').toISOString()).toBe('2026-08-23T05:00:00.000Z');
  });

  it('con 1 día es solo hoy desde la medianoche', () => {
    const ahora = new Date('2026-11-20T15:00:00Z');
    expect(inicioHistorico(ahora, 'America/Lima', 1).toISOString()).toBe(
      '2026-11-20T05:00:00.000Z',
    );
  });
});
