import { describe, expect, it } from 'vitest';
import { instanteLocal, type Tramo } from './horario';
import {
  UMBRALES_POR_DEFECTO as U,
  acumuladoVacio,
  agregarPeriodo,
  calcularIndicadores,
  crearJornadas,
  mediana,
  metricasLead,
  sumarAcumulados,
  type DatosLead,
  type MensajeLead,
  type TiempoAsesor,
} from './indicadores';

const LIMA = 'America/Lima';
const L = (dia: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return instanteLocal(2026, 11, dia, h, m, LIMA);
};
// Horario provisional de Jade18K: L–V 9:00–13:00 y 14:00–18:00.
const horario: Tramo[] = [1, 2, 3, 4, 5].flatMap((d) => [
  { diaSemana: d, inicio: '09:00', fin: '13:00', vigenteDesde: '2026-01-01' },
  { diaSemana: d, inicio: '14:00', fin: '18:00', vigenteDesde: '2026-01-01' },
]);
const T: TiempoAsesor = { horario, ausencias: [], zona: LIMA };

const ent = (f: Date): MensajeLead => ({ fecha: f, direccion: 'inbound', origen: null });
const hum = (f: Date): MensajeLead => ({ fecha: f, direccion: 'outbound', origen: 'manual' });
const ia = (f: Date): MensajeLead => ({ fecha: f, direccion: 'outbound', origen: 'agente_ia' });
const wf = (f: Date): MensajeLead => ({ fecha: f, direccion: 'outbound', origen: 'workflow' });

const lead = (mensajes: MensajeLead[], extra: Partial<DatosLead> = {}): DatosLead => ({
  ingresoEn: mensajes[0]!.fecha,
  mensajes,
  estado: 'abierto',
  etapaEstandar: 'contactado',
  ventaEn: null,
  ...extra,
});

const headline = (f: Date): MensajeLead => ({ ...ent(f), entrada: true });

describe('metricasLead: atención (reglas del 16 nov 2026)', () => {
  it('mide cada mensaje respondido por el asesor, desde el primero sin responder; el Headline no cuenta', () => {
    const d = lead([
      headline(L(16, '10:00')),
      ent(L(16, '10:02')),
      ent(L(16, '10:05')),
      hum(L(16, '10:20')),
      ent(L(16, '10:30')),
      hum(L(16, '10:34')),
    ]);
    const m = metricasLead(d, T, U, L(16, '11:00'));
    expect(m.respuestasAsesor.map((r) => r.minutos)).toEqual([18, 4]);
    expect(m.respuestasAsesor[0]!.clienteEn).toEqual(L(16, '10:02'));
    expect(m.minutosRespuesta).toBe(18);
    expect(m.sinResponder).toBe(false);
  });

  it('un lead que solo trae el Headline no queda sin responder', () => {
    const m = metricasLead(lead([headline(L(16, '10:00'))]), T, U, L(16, '12:00'));
    expect(m.sinResponder).toBe(false);
    expect(m.respuestasAsesor).toEqual([]);
  });

  it('si el agente IA responde antes que el asesor, es una respuesta ganada por la IA', () => {
    const d = lead([ent(L(16, '12:58')), ia(L(16, '12:59')), hum(L(16, '14:03'))]);
    const m = metricasLead(d, T, U, L(16, '15:00'));
    expect(m.ganadasIa).toEqual([L(16, '12:58')]);
    expect(m.respuestasAsesor).toEqual([]);
    expect(m.minutosRespuesta).toBeNull();
    expect(m.sinResponder).toBe(false);
  });

  it('a igual hora, la respuesta del agente IA va después del mensaje del cliente', () => {
    const m = metricasLead(lead([ia(L(16, '10:00')), ent(L(16, '10:00'))]), T, U, L(16, '11:00'));
    expect(m.ganadasIa).toHaveLength(1);
    expect(m.sinResponder).toBe(false);
  });

  it('el tiempo del asesor corre en minutos laborales', () => {
    const d = lead([ent(L(16, '12:58')), hum(L(16, '14:03'))]);
    expect(metricasLead(d, T, U, L(16, '15:00')).minutosRespuesta).toBe(5); // 2 antes del almuerzo + 3
  });

  it('sin responder: mensaje que no respondió nadie (asesor, agente IA ni workflow)', () => {
    const d = lead([ent(L(16, '10:00')), ent(L(16, '10:05'))]);
    const m = metricasLead(d, T, U, L(16, '11:00'));
    expect(m.sinResponder).toBe(true);
    expect(m.pendienteDesde).toEqual(L(16, '10:00'));
  });

  it('si un workflow responde antes que el asesor, la respuesta es suya y no se mide al asesor', () => {
    const d = lead([ent(L(16, '10:00')), wf(L(16, '10:01')), hum(L(16, '10:30'))]);
    const m = metricasLead(d, T, U, L(16, '11:00'));
    expect(m.respondidasWorkflow).toEqual([L(16, '10:00')]);
    expect(m.respuestasAsesor).toEqual([]);
    expect(m.sinResponder).toBe(false);
  });

  it('caso real: entra por Headline, el workflow responde en Nuevo y el cliente deja en visto', () => {
    // Pasa a Contactado tras la bienvenida; el cliente no vuelve a escribir y se marca perdido.
    const d = lead(
      [headline(L(16, '22:06')), wf(L(16, '22:06')), ent(L(16, '22:06')), wf(L(16, '22:06'))],
      { estado: 'perdido', periodosNuevo: [{ desde: L(16, '22:06'), hasta: L(16, '22:07') }] },
    );
    const m = metricasLead(d, T, U, L(19, '10:00'));
    expect(m.sinResponder).toBe(false);
    expect(m.perdidoPorFaltaSeguimiento).toBe(false);
    expect(m.respuestasAsesor).toEqual([]);
  });

  it('en la etapa Nuevo no se mide nada', () => {
    const periodosNuevo = [{ desde: L(16, '09:00'), hasta: L(16, '11:00') }];
    const d = lead(
      [ent(L(16, '10:00')), hum(L(16, '10:30')), ent(L(16, '11:30')), hum(L(16, '11:40'))],
      { periodosNuevo },
    );
    expect(metricasLead(d, T, U, L(16, '12:00')).respuestasAsesor.map((r) => r.minutos)).toEqual([
      10,
    ]);
    // Sigue en Nuevo y sin historial: su mensaje no queda como sin responder.
    const nuevo = lead([ent(L(16, '10:00'))], { etapaEstandar: 'nuevo' });
    const m = metricasLead(nuevo, T, U, L(16, '12:00'));
    expect(m.sinResponder).toBe(false);
    expect(m.pendienteDesde).toBeNull();
  });

  it('un lead perdido sale de sin responder', () => {
    const d = lead([ent(L(16, '10:00'))], { estado: 'perdido' });
    expect(metricasLead(d, T, U, L(16, '11:00')).sinResponder).toBe(false);
  });

  it('en espera: ya conversaba y su mensaje lleva más de 15 min laborales sin respuesta', () => {
    const base = [ent(L(16, '10:00')), hum(L(16, '10:05')), ent(L(16, '10:30'))];
    expect(metricasLead(lead(base), T, U, L(16, '10:50')).enEspera).toBe(true);
    expect(metricasLead(lead(base), T, U, L(16, '10:40')).enEspera).toBe(false);
    // Si el agente IA lo respondió, ya no está esperando.
    expect(metricasLead(lead([...base, ia(L(16, '10:31'))]), T, U, L(16, '10:50')).enEspera).toBe(
      false,
    );
    // Fuera de horario no corre el reloj: 12:55 → 14:05 = 5 + 5 min.
    const almuerzo = [ent(L(16, '10:00')), hum(L(16, '10:05')), ent(L(16, '12:55'))];
    expect(metricasLead(lead(almuerzo), T, U, L(16, '14:05')).enEspera).toBe(false);
  });
});

describe('turno automático del asesor (17 nov 2026)', () => {
  // Stephanie escribe a clientes 9:30–13:00, vuelve 16:30 (pausa de 3,5 h) y al día siguiente 9:10.
  const actividad = new Map([
    [
      'S',
      [
        L(16, '09:30'),
        L(16, '11:00'),
        L(16, '13:00'),
        L(16, '16:30'),
        L(16, '18:40'),
        L(17, '09:10'),
      ],
    ],
  ]);
  const j = crearJornadas(actividad);
  const manual = (f: Date): MensajeLead => ({
    fecha: f,
    direccion: 'outbound',
    origen: 'manual',
    userId: 'S',
  });

  it('antes de empezar: el reloj corre desde su primera actividad', () => {
    expect(j.inicio('S', L(16, '07:42'))).toEqual(L(16, '09:30'));
  });

  it('en turno (menos de 3 h sin actividad): desde el mensaje del cliente', () => {
    expect(j.inicio('S', L(16, '10:15'))).toEqual(L(16, '10:15'));
    expect(j.enTurno('S', L(16, '12:00'))).toBe(true);
  });

  it('más de 3 h sin escribir a ningún cliente: fuera de turno hasta que vuelve', () => {
    expect(j.inicio('S', L(16, '13:30'))).toEqual(L(16, '16:30')); // pausa 13:00 → 16:30
    expect(j.enTurno('S', L(16, '16:10'))).toBe(false);
    expect(j.inicio('S', L(16, '21:00'))).toEqual(L(17, '09:10')); // noche
  });

  it('última actividad hasta un instante (cierre del turno)', () => {
    expect(j.ultimaActividad('S', L(16, '23:59'))).toEqual(L(16, '18:40'));
    expect(j.ultimaActividad('S', L(16, '08:00'))).toBeNull();
  });

  it('sin actividad conocida: desde el mensaje del cliente y en turno', () => {
    expect(j.inicio('X', L(16, '07:42'))).toEqual(L(16, '07:42'));
    expect(j.enTurno(null, L(16, '07:42'))).toBe(true);
  });

  it('caso real: "Ok gracias" a las 7:42, la asesora empezó 9:30 y respondió 9:43 → 13 min', () => {
    const d = lead([ia(L(16, '07:41')), ent(L(16, '07:42')), manual(L(16, '09:43'))], {
      jornadas: crearJornadas(new Map([['S', [L(16, '09:30'), L(16, '09:43')]]])),
    });
    expect(metricasLead(d, T, U, L(16, '10:00')).respuestasAsesor.map((r) => r.minutos)).toEqual([
      13,
    ]);
  });

  it('sin responder es falta desde 15 min si el asesor está en turno; fuera de turno no es falta', () => {
    const d = lead([ent(L(16, '12:40'))], { asesorId: 'S', jornadas: j });
    expect(metricasLead(d, T, U, L(16, '12:50')).sinResponder).toBe(false); // 10 min
    expect(metricasLead(d, T, U, L(16, '12:56')).sinResponder).toBe(true); // 16 min, en turno
    const tarde = metricasLead(d, T, U, L(16, '16:20')); // 3 h 20 sin actividad
    expect(tarde.sinResponder).toBe(false);
    expect(tarde.pendienteFueraDeTurno).toBe(true);
  });
});

describe('metricasLead: intentos y respuesta efectiva', () => {
  it('cuenta bloques de salientes humanos, no mensajes sueltos', () => {
    const d = lead([
      ent(L(16, '10:00')),
      hum(L(16, '10:05')),
      hum(L(16, '10:06')), // mismo bloque
      ia(L(16, '10:30')), // la IA no es un intento del asesor
      hum(L(16, '15:00')), // > 60 min laborales después: nuevo intento
      ent(L(17, '09:10')),
      hum(L(17, '09:12')), // tras un mensaje del cliente: nuevo bloque
    ]);
    expect(metricasLead(d, T, U, L(17, '10:00')).intentos).toBe(3);
  });

  it('respuesta efectiva: dentro del SLA y el cliente vuelve a escribir', () => {
    const si = lead([ent(L(16, '10:00')), hum(L(16, '10:04')), ent(L(16, '10:20'))]);
    const sinVuelta = lead([ent(L(16, '10:00')), hum(L(16, '10:04'))]);
    const tarde = lead([ent(L(16, '10:00')), hum(L(16, '10:10')), ent(L(16, '10:20'))]);
    expect(metricasLead(si, T, U, L(16, '11:00')).respuestaEfectiva).toBe(true);
    expect(metricasLead(sinVuelta, T, U, L(16, '11:00')).respuestaEfectiva).toBe(false);
    expect(metricasLead(tarde, T, U, L(16, '11:00')).respuestaEfectiva).toBe(false);
  });
});

describe('metricasLead: seguimiento, abandono y pérdidas', () => {
  it('seguimiento vencido: Por cerrar y más de 1 día laboral sin saliente humano', () => {
    const d = lead([ent(L(16, '10:00')), hum(L(16, '10:05'))], { etapaEstandar: 'por_cerrar' });
    expect(metricasLead(d, T, U, L(17, '10:00')).seguimientoVencido).toBe(false); // 1 día justo
    expect(metricasLead(d, T, U, L(17, '11:00')).seguimientoVencido).toBe(true);
  });

  it('seguimiento vencido por tarea vencida; programado si la tarea es futura', () => {
    const msgs = [ent(L(16, '10:00')), hum(L(16, '10:05'))];
    const vencida = lead(msgs, {
      etapaEstandar: 'interesado',
      tareas: [{ venceEn: L(16, '11:00'), completada: false }],
    });
    const futura = lead(msgs, {
      etapaEstandar: 'interesado',
      tareas: [{ venceEn: L(18, '11:00'), completada: false }],
    });
    const hecha = lead(msgs, {
      etapaEstandar: 'interesado',
      tareas: [{ venceEn: L(16, '11:00'), completada: true }],
    });
    expect(metricasLead(vencida, T, U, L(16, '12:00')).seguimientoVencido).toBe(true);
    const f = metricasLead(futura, T, U, L(16, '12:00'));
    expect([f.seguimientoVencido, f.seguimientoProgramado]).toEqual([false, true]);
    expect(metricasLead(hecha, T, U, L(16, '12:00')).seguimientoVencido).toBe(false);
  });

  it('solo cuentan para seguimiento las etapas Interesado y Por cerrar, y no los perdidos', () => {
    const msgs = [ent(L(16, '10:00')), hum(L(16, '10:05'))];
    expect(
      metricasLead(lead(msgs, { etapaEstandar: 'contactado' }), T, U, L(20, '10:00'))
        .seguimientoVencido,
    ).toBe(false);
    expect(
      metricasLead(
        lead(msgs, { etapaEstandar: 'por_cerrar', estado: 'perdido' }),
        T,
        U,
        L(20, '10:00'),
      ).seguimientoVencido,
    ).toBe(false);
  });

  it('abandono: último saliente sin respuesta del cliente por 72 h y sin venta', () => {
    const msgs = [ent(L(16, '10:00')), hum(L(16, '10:05'))];
    expect(metricasLead(lead(msgs), T, U, L(19, '10:06')).abandono).toBe(true);
    expect(metricasLead(lead(msgs), T, U, L(19, '10:00')).abandono).toBe(false);
    expect(
      metricasLead(lead(msgs, { estado: 'ganado', ventaEn: L(16, '11:00') }), T, U, L(19, '10:06'))
        .abandono,
    ).toBe(false);
  });

  it('perdido por falta de seguimiento: solo si se perdió con un mensaje del cliente que nadie respondió', () => {
    const clienteSinRespuesta = lead(
      [ent(L(16, '10:00')), hum(L(16, '10:05')), ent(L(16, '10:30'))],
      { estado: 'perdido' },
    );
    // El cliente dejó en visto la respuesta (del asesor, la IA o un workflow): no es error del asesor.
    const dejoEnVisto = lead([ent(L(16, '10:00')), hum(L(16, '10:05'))], { estado: 'perdido' });
    const vistoTrasWorkflow = lead([ent(L(16, '10:00')), wf(L(16, '10:01'))], {
      estado: 'perdido',
    });
    expect(metricasLead(clienteSinRespuesta, T, U, L(17, '10:00')).perdidoPorFaltaSeguimiento).toBe(
      true,
    );
    expect(metricasLead(dejoEnVisto, T, U, L(17, '10:00')).perdidoPorFaltaSeguimiento).toBe(false);
    expect(metricasLead(vistoTrasWorkflow, T, U, L(17, '10:00')).perdidoPorFaltaSeguimiento).toBe(
      false,
    );
  });

  it('interesados de días anteriores y si fueron contactados hoy', () => {
    const ayer = [ent(L(16, '10:00')), hum(L(16, '10:05'))];
    const sinHoy = metricasLead(lead(ayer, { etapaEstandar: 'interesado' }), T, U, L(17, '12:00'));
    expect([sinHoy.interesadoDiasAnteriores, sinHoy.contactadoHoy]).toEqual([true, false]);
    const conHoy = metricasLead(
      lead([...ayer, hum(L(17, '09:30'))], { etapaEstandar: 'interesado' }),
      T,
      U,
      L(17, '12:00'),
    );
    expect([conHoy.interesadoDiasAnteriores, conHoy.contactadoHoy]).toEqual([true, true]);
  });

  it('días laborales de cierre: ingreso → venta', () => {
    const d = lead([ent(L(16, '09:00'))], { estado: 'ganado', ventaEn: L(18, '09:00') });
    expect(metricasLead(d, T, U, L(18, '12:00')).diasCierre).toBeCloseTo(2);
  });
});

describe('agregación sumable', () => {
  it('la mediana se calcula sobre todos los registros, no como promedio de medianas', () => {
    const a = { ...acumuladoVacio(), leadsRecibidos: 3, tiemposRespuesta: [1, 2, 3] };
    const b = { ...acumuladoVacio(), leadsRecibidos: 1, tiemposRespuesta: [100] };
    const i = calcularIndicadores(sumarAcumulados([a, b]), 1);
    expect(i.tiempoRespuestaMediana).toBe(2.5);
    expect(i.tiempoRespuestaPromedio).toBeCloseTo(26.5);
    expect(mediana([])).toBeNull();
  });

  it('un periodo suma los días y toma la foto del último día', () => {
    const d1 = { ...acumuladoVacio(), leadsRecibidos: 10, ventas: 1, fotoSinResponder: 7 };
    const d2 = { ...acumuladoVacio(), leadsRecibidos: 10, ventas: 2, fotoSinResponder: 3 };
    const p = agregarPeriodo([d1, d2]);
    expect(p.leadsRecibidos).toBe(20);
    expect(p.ventas).toBe(3);
    expect(p.fotoSinResponder).toBe(3);
  });

  it('la conversión incluye a los leads perdidos en el denominador', () => {
    const a = { ...acumuladoVacio(), leadsRecibidos: 50, ventas: 6, perdidos: 20 };
    expect(calcularIndicadores(a, 7).conversion).toBe(12);
  });

  it('cumplimiento de seguimiento = interesados contactados hoy ÷ interesados de días anteriores', () => {
    const a = {
      ...acumuladoVacio(),
      fotoInteresadosAnteriores: 10,
      fotoInteresadosContactadosHoy: 6,
    };
    expect(calcularIndicadores(a, 1).cumplimientoSeguimientoPct).toBe(60);
  });
});
