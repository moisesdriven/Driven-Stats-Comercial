import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { instanteLocal, type Acumulado } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { baseWorker, URL_PRUEBAS } from '../pruebas/base';
import { calcularResumen } from './resumen';

const LOC = 'LOC_RES';
const LIMA = 'America/Lima';
// 16/11/2026 lunes, 17/11 martes.
const L = (dia: number, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return instanteLocal(2026, 11, dia, h, m, LIMA);
};

describe.skipIf(!URL_PRUEBAS)('calcular:resumen (integración)', () => {
  let db: Db;
  let n = 0;
  const msg = (
    contacto: string,
    fecha: Date,
    direccion: 'inbound' | 'outbound',
    origen: string | null,
  ) => ({
    messageId: `m${++n}`,
    locationId: LOC,
    conversationId: `c_${contacto}`,
    contactId: contacto,
    direccion,
    origen: origen as 'manual' | null,
    fecha,
  });

  beforeAll(async () => {
    db = await baseWorker();
    await db
      .insert(tablas.subcuentas)
      .values({ locationId: LOC, nombre: 'Resumen', zonaHoraria: LIMA });
    // Horario general provisional: L–V 9–13 y 14–18.
    await db.insert(tablas.horarios).values(
      [1, 2, 3, 4, 5].flatMap((d) => [
        {
          locationId: LOC,
          userId: null,
          diaSemana: d,
          horaInicio: '09:00',
          horaFin: '13:00',
          vigenteDesde: '2026-01-01',
        },
        {
          locationId: LOC,
          userId: null,
          diaSemana: d,
          horaInicio: '14:00',
          horaFin: '18:00',
          vigenteDesde: '2026-01-01',
        },
      ]),
    );
    await db.insert(tablas.mensajes).values([
      // K1 (U1): IA y workflow responden al instante; la asesora a las 14:03 = 5 min laborales.
      msg('K1', L(16, '12:58'), 'inbound', null),
      msg('K1', L(16, '12:58'), 'outbound', 'workflow'),
      msg('K1', L(16, '12:59'), 'outbound', 'agente_ia'),
      msg('K1', L(16, '14:03'), 'outbound', 'manual'),
      msg('K1', L(16, '14:10'), 'inbound', null),
      msg('K1', L(16, '14:12'), 'outbound', 'manual'),
      // K2 (U1): solo la IA. Queda sin responder.
      msg('K2', L(16, '10:00'), 'inbound', null),
      msg('K2', L(16, '10:00'), 'outbound', 'agente_ia'),
      // K3 (U2): respuesta a los 30 min; venta el martes.
      msg('K3', L(16, '10:00'), 'inbound', null),
      msg('K3', L(16, '10:30'), 'outbound', 'manual'),
      // K4 (U2): perdido el martes; su último mensaje quedó sin respuesta.
      msg('K4', L(16, '11:00'), 'inbound', null),
      msg('K4', L(16, '11:20'), 'outbound', 'manual'),
      msg('K4', L(16, '11:30'), 'inbound', null),
    ]);
    await db.insert(tablas.oportunidades).values([
      {
        opportunityId: 'O3',
        locationId: LOC,
        contactId: 'K3',
        status: 'open',
        stageId: 'S_ADEL',
        etapaEstandar: 'ganado',
        monto: 1000,
        asesorId: 'U2',
        creadaEn: L(16, '10:00'),
        ventaEn: L(17, '11:00'),
      },
      {
        opportunityId: 'O4',
        locationId: LOC,
        contactId: 'K4',
        status: 'lost',
        stageId: 'S_CONT',
        motivoPerdida: 'M1',
        asesorId: 'U2',
        creadaEn: L(16, '11:00'),
        perdidaEn: L(17, '12:00'),
      },
    ]);
    const lead = (
      contactId: string,
      asesorId: string,
      ingreso: Date,
      estado: string,
      etapa: string,
      opp: string | null,
    ) => ({
      locationId: LOC,
      contactId,
      conversationId: `c_${contactId}`,
      opportunityId: opp,
      asesorId,
      ingresoEn: ingreso,
      estado,
      etapaEstandar: etapa,
    });
    await db
      .insert(tablas.leads)
      .values([
        lead('K1', 'U1', L(16, '12:58'), 'abierto', 'contactado', null),
        lead('K2', 'U1', L(16, '10:00'), 'abierto', 'nuevo', null),
        lead('K3', 'U2', L(16, '10:00'), 'ganado', 'ganado', 'O3'),
        lead('K4', 'U2', L(16, '11:00'), 'perdido', 'contactado', 'O4'),
      ]);
    await calcularResumen(db, LOC, {
      desde: '2026-11-16',
      hasta: '2026-11-17',
      ahora: L(17, '18:30'),
    });
  });

  const fila = async (fecha: string, asesor: string | null) => {
    const [f] = await db
      .select()
      .from(tablas.resumenDiario)
      .where(
        and(
          eq(tablas.resumenDiario.fecha, fecha),
          eq(tablas.resumenDiario.locationId, LOC),
          asesor
            ? eq(tablas.resumenDiario.asesorId, asesor)
            : isNull(tablas.resumenDiario.asesorId),
        ),
      );
    return f?.indicadores as Acumulado | undefined;
  };

  it('cohorte del lunes: leads recibidos y tiempos de respuesta humanos en minutos laborales', async () => {
    const total = await fila('2026-11-16', null);
    expect(total?.leadsRecibidos).toBe(4);
    expect([...(total?.tiemposRespuesta ?? [])].sort((a, b) => a - b)).toEqual([5, 20, 30]);
    expect(total?.respuestasEfectivas).toBe(1); // K1: 5 min y el cliente volvió a escribir
    const u1 = await fila('2026-11-16', 'U1');
    expect(u1?.leadsRecibidos).toBe(2);
    expect(u1?.tiemposRespuesta).toEqual([5]);
  });

  it('fotos al cierre: el lead atendido solo por la IA sigue sin responder; el perdido no cuenta', async () => {
    const martes = await fila('2026-11-17', null);
    expect(martes?.fotoSinResponder).toBe(1);
    expect((await fila('2026-11-17', 'U1'))?.fotoSinResponder).toBe(1);
  });

  it('la venta se atribuye al asesor de la oportunidad el día de la venta, con días laborales de cierre', async () => {
    const u2 = await fila('2026-11-17', 'U2');
    expect(u2?.ventas).toBe(1);
    expect(u2?.montoVentas).toBe(1000);
    expect(u2?.sumaDiasCierre).toBeCloseTo(1.125); // lunes 10:00 → martes 11:00
    expect((await fila('2026-11-16', 'U2'))?.ventasCohorte).toBe(1);
  });

  it('pérdida con motivo y perdido por falta de seguimiento', async () => {
    const u2 = await fila('2026-11-17', 'U2');
    expect(u2?.perdidos).toBe(1);
    expect(u2?.perdidosPorMotivo).toEqual({ M1: 1 });
    expect(u2?.perdidosFaltaSeguimiento).toBe(1);
  });

  it('actualiza los campos derivados de cada lead', async () => {
    const [k1] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K1'));
    expect(k1?.minutosLaboralesRespuesta).toBe(5);
    expect(k1?.intentos).toBe(2);
    expect(k1?.respuestaEfectiva).toBe(true);
  });

  it('guarda estados por etapa y cuello de botella en cada fila', async () => {
    const [f] = await db
      .select()
      .from(tablas.resumenDiario)
      .where(
        and(eq(tablas.resumenDiario.fecha, '2026-11-16'), isNull(tablas.resumenDiario.asesorId)),
      );
    expect(f?.estadosEtapa).toHaveProperty('atencion');
    expect(f?.cuelloBotella).toBe('atencion'); // mediana 20 min frente a la meta de 5
  });

  it('recalcular es idempotente', async () => {
    const antes = (await db.select().from(tablas.resumenDiario)).length;
    await calcularResumen(db, LOC, {
      desde: '2026-11-16',
      hasta: '2026-11-17',
      ahora: L(17, '18:30'),
    });
    expect((await db.select().from(tablas.resumenDiario)).length).toBe(antes);
  });
});
