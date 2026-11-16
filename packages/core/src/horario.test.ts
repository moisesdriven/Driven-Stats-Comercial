import { describe, expect, it } from 'vitest';
import {
  diasLaborales,
  enHorarioLaboral,
  instanteLocal,
  minutosJornada,
  minutosLaborales,
  sumarTiempoLaboral,
  type Ausencia,
  type Tramo,
} from './horario';

const LIMA = 'America/Lima';
// 2026-11-16 es lunes. Lima = UTC−5 (sin horario de verano).
const L = (dia: number, hhmm: string, zona = LIMA) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return instanteLocal(2026, 11, dia, h, m, zona);
};

/** Lunes a viernes 9:00–13:00 y 15:00–19:00 (tramos partidos, como en el diseño). */
const partido = (desde = '2026-01-01', hasta: string | null = null): Tramo[] =>
  [1, 2, 3, 4, 5].flatMap((d) => [
    { diaSemana: d, inicio: '09:00', fin: '13:00', vigenteDesde: desde, vigenteHasta: hasta },
    { diaSemana: d, inicio: '15:00', fin: '19:00', vigenteDesde: desde, vigenteHasta: hasta },
  ]);
const SIN: Ausencia[] = [];

describe('minutosLaborales', () => {
  const h = partido();

  it('dentro de un mismo tramo', () => {
    expect(minutosLaborales(L(16, '09:10'), L(16, '09:25'), h, SIN, LIMA)).toBe(15);
  });

  it('tramos partidos: no cuenta el almuerzo', () => {
    // 12:50 → 15:10 = 10 min antes del almuerzo + 10 min después.
    expect(minutosLaborales(L(16, '12:50'), L(16, '15:10'), h, SIN, LIMA)).toBe(20);
  });

  it('lead fuera de horario: empieza a contar al inicio del siguiente tramo', () => {
    // Entra a las 21:00 del lunes, respuesta a las 9:05 del martes = 5 min.
    expect(minutosLaborales(L(16, '21:00'), L(17, '09:05'), h, SIN, LIMA)).toBe(5);
    // Entra en el almuerzo (13:30) y se responde a las 15:02 = 2 min.
    expect(minutosLaborales(L(16, '13:30'), L(16, '15:02'), h, SIN, LIMA)).toBe(2);
  });

  it('intervalos que cruzan varios días', () => {
    // Lunes 18:00 → miércoles 10:00 = 60 (lun) + 480 (mar) + 60 (mié).
    expect(minutosLaborales(L(16, '18:00'), L(18, '10:00'), h, SIN, LIMA)).toBe(600);
  });

  it('fin de semana no cuenta', () => {
    // Viernes 18:30 → lunes 9:30 = 30 + 30.
    expect(minutosLaborales(L(20, '18:30'), L(23, '09:30'), h, SIN, LIMA)).toBe(60);
    // Todo dentro del sábado y domingo = 0.
    expect(minutosLaborales(L(21, '10:00'), L(22, '18:00'), h, SIN, LIMA)).toBe(0);
  });

  it('feriado de toda la subcuenta no cuenta', () => {
    const feriado: Ausencia[] = [{ inicio: L(17, '00:00'), fin: L(18, '00:00') }];
    expect(minutosLaborales(L(16, '18:00'), L(18, '10:00'), h, feriado, LIMA)).toBe(120);
  });

  it('vacaciones o permiso parcial del asesor no cuentan', () => {
    const permiso: Ausencia[] = [{ inicio: L(16, '10:00'), fin: L(16, '12:00') }];
    expect(minutosLaborales(L(16, '09:00'), L(16, '13:00'), h, permiso, LIMA)).toBe(120);
  });

  it('cambio de horario por vigencia', () => {
    // Hasta el 17 tramos partidos; desde el 18, jornada corrida 8:00–16:00.
    const horario: Tramo[] = [
      ...partido('2026-01-01', '2026-11-17'),
      ...[1, 2, 3, 4, 5].map((d) => ({
        diaSemana: d,
        inicio: '08:00',
        fin: '16:00',
        vigenteDesde: '2026-11-18',
      })),
    ];
    // Martes 18:00 → miércoles 9:00 = 60 (martes) + 60 (miércoles desde las 8:00).
    expect(minutosLaborales(L(17, '18:00'), L(18, '09:00'), horario, SIN, LIMA)).toBe(120);
  });

  it('fin antes o igual al inicio da 0', () => {
    expect(minutosLaborales(L(16, '10:00'), L(16, '09:00'), h, SIN, LIMA)).toBe(0);
  });

  it('horario vacío da 0', () => {
    expect(minutosLaborales(L(16, '09:00'), L(18, '09:00'), [], SIN, LIMA)).toBe(0);
  });
});

describe('cambio de horario de verano (cualquier zona, aunque Lima no lo use)', () => {
  const NY = 'America/New_York';
  // Domingo 8 de marzo de 2026: en Nueva York el reloj salta de 2:00 a 3:00.
  const domingo: Tramo[] = [
    { diaSemana: 7, inicio: '00:00', fin: '24:00', vigenteDesde: '2026-01-01' },
  ];
  const NYL = (dia: number, h: number, m = 0) => instanteLocal(2026, 3, dia, h, m, NY);

  it('el día del salto dura 23 horas laborales', () => {
    expect(minutosJornada(domingo, '2026-03-08', NY)).toBe(23 * 60);
    expect(minutosLaborales(NYL(8, 0), NYL(8, 4), domingo, SIN, NY)).toBe(180);
  });

  it('una hora local inexistente se ajusta al primer instante válido', () => {
    expect(instanteLocal(2026, 3, 8, 2, 30, NY).toISOString()).toBe(
      instanteLocal(2026, 3, 8, 3, 0, NY).toISOString(),
    );
  });

  it('una hora local repetida (fin del horario de verano) usa la primera ocurrencia', () => {
    // 1 de noviembre de 2026: la 1:30 ocurre dos veces en Nueva York (EDT y luego EST).
    expect(instanteLocal(2026, 11, 1, 1, 30, NY).toISOString()).toBe('2026-11-01T05:30:00.000Z');
  });

  it('una jornada de 9:00 a 17:00 sigue durando 8 horas al cambiar de horario', () => {
    const habil: Tramo[] = [1, 2, 3, 4, 5].map((d) => ({
      diaSemana: d,
      inicio: '09:00',
      fin: '17:00',
      vigenteDesde: '2026-01-01',
    }));
    // Viernes 6 (EST) 16:00 → lunes 9 (EDT) 10:00 = 60 + 60.
    expect(minutosLaborales(NYL(6, 16), NYL(9, 10), habil, SIN, NY)).toBe(120);
  });
});

describe('sumarTiempoLaboral', () => {
  const h = partido();

  it('1 día laboral desde el lunes 10:00 vence el martes 10:00', () => {
    expect(sumarTiempoLaboral(L(16, '10:00'), 480, h, SIN, LIMA)?.toISOString()).toBe(
      L(17, '10:00').toISOString(),
    );
  });

  it('salta el almuerzo, el fin de semana y los feriados', () => {
    expect(sumarTiempoLaboral(L(16, '12:30'), 60, h, SIN, LIMA)?.toISOString()).toBe(
      L(16, '15:30').toISOString(),
    );
    expect(sumarTiempoLaboral(L(20, '18:30'), 60, h, SIN, LIMA)?.toISOString()).toBe(
      L(23, '09:30').toISOString(),
    );
    const feriado: Ausencia[] = [{ inicio: L(23, '00:00'), fin: L(24, '00:00') }];
    expect(sumarTiempoLaboral(L(20, '18:30'), 60, h, feriado, LIMA)?.toISOString()).toBe(
      L(24, '09:30').toISOString(),
    );
  });

  it('con 0 minutos devuelve el inicio del siguiente tramo', () => {
    expect(sumarTiempoLaboral(L(16, '21:00'), 0, h, SIN, LIMA)?.toISOString()).toBe(
      L(17, '09:00').toISOString(),
    );
    expect(sumarTiempoLaboral(L(16, '10:00'), 0, h, SIN, LIMA)?.toISOString()).toBe(
      L(16, '10:00').toISOString(),
    );
  });

  it('es la inversa de minutosLaborales', () => {
    const inicio = L(19, '17:47');
    const fin = sumarTiempoLaboral(inicio, 1234, h, SIN, LIMA)!;
    expect(minutosLaborales(inicio, fin, h, SIN, LIMA)).toBeCloseTo(1234, 6);
  });

  it('sin horario devuelve null', () => {
    expect(sumarTiempoLaboral(L(16, '10:00'), 10, [], SIN, LIMA)).toBeNull();
  });
});

describe('diasLaborales', () => {
  const h = partido();

  it('una jornada completa es 1 día', () => {
    expect(diasLaborales(L(16, '09:00'), L(16, '19:00'), h, SIN, LIMA)).toBeCloseTo(1);
  });

  it('cuenta fracciones según la jornada de ese día', () => {
    // Lunes 15:00 → miércoles 11:00 = 0,5 + 1 + 0,25.
    expect(diasLaborales(L(16, '15:00'), L(18, '11:00'), h, SIN, LIMA)).toBeCloseTo(1.75);
  });

  it('un día con jornada más corta pesa igual que uno completo', () => {
    const conSabado: Tramo[] = [
      ...h,
      { diaSemana: 6, inicio: '09:00', fin: '13:00', vigenteDesde: '2026-01-01' },
    ];
    expect(diasLaborales(L(21, '09:00'), L(21, '13:00'), conSabado, SIN, LIMA)).toBeCloseTo(1);
  });

  it('las ausencias reducen los días', () => {
    const vacaciones: Ausencia[] = [{ inicio: L(17, '00:00'), fin: L(18, '00:00') }];
    expect(diasLaborales(L(16, '09:00'), L(18, '19:00'), h, vacaciones, LIMA)).toBeCloseTo(2);
  });
});

describe('enHorarioLaboral', () => {
  it('distingue dentro y fuera del horario', () => {
    const h = partido();
    expect(enHorarioLaboral(L(16, '10:00'), h, SIN, LIMA)).toBe(true);
    expect(enHorarioLaboral(L(16, '13:30'), h, SIN, LIMA)).toBe(false);
    expect(enHorarioLaboral(L(21, '10:00'), h, SIN, LIMA)).toBe(false);
  });
});
