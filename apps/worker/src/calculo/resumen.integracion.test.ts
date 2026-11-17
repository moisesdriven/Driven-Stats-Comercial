import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { instanteLocal, type Acumulado } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { baseWorker, URL_PRUEBAS } from '../pruebas/base';
import { recalcularPendientes } from './pendientes';
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
    texto: string | null = null,
  ) => ({
    messageId: `m${++n}`,
    locationId: LOC,
    conversationId: `c_${contacto}`,
    contactId: contacto,
    direccion,
    origen: origen as 'manual' | null,
    texto,
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
      // K2 (U1): sigue en Nuevo (sin historial): no se mide aunque le respondió la IA.
      msg('K2', L(16, '10:00'), 'inbound', null),
      msg('K2', L(16, '10:00'), 'outbound', 'agente_ia'),
      // K3 (U2): respuesta a los 30 min; venta el martes.
      msg('K3', L(16, '10:00'), 'inbound', null),
      msg('K3', L(16, '10:30'), 'outbound', 'manual'),
      // K4 (U2): perdido el martes; su último mensaje quedó sin respuesta.
      msg('K4', L(16, '11:00'), 'inbound', null),
      msg('K4', L(16, '11:20'), 'outbound', 'manual'),
      msg('K4', L(16, '11:30'), 'inbound', null),
      // K5 (U3): entra con el Headline; mientras está en Nuevo (9:00–10:00) no se mide; luego 10 min.
      msg(
        'K5',
        L(16, '09:00'),
        'inbound',
        null,
        '*Headline:* Anillo de compromiso *Source URL:* …',
      ),
      msg('K5', L(16, '09:30'), 'inbound', null),
      msg('K5', L(16, '09:40'), 'outbound', 'manual'),
      msg('K5', L(16, '10:15'), 'inbound', null),
      msg('K5', L(16, '10:25'), 'outbound', 'manual'),
    ]);
    // La etapa estándar sale del mapa: la fila del historial (de una actividad) no la trae.
    await db.insert(tablas.mapaEtapas).values({
      locationId: LOC,
      pipelineId: 'P1',
      stageId: 'S_NUEVO',
      nombreOriginal: 'Nuevo',
      etapaEstandar: 'nuevo',
    });
    await db.insert(tablas.historialEtapas).values({
      opportunityId: 'O5',
      locationId: LOC,
      contactId: 'K5',
      stageId: 'S_NUEVO',
      etapaEstandar: null,
      desde: L(16, '09:00'),
      hasta: L(16, '10:00'),
      fuente: 'actividad',
    });
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
        lead('K5', 'U3', L(16, '09:00'), 'abierto', 'contactado', null),
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

  it('tiempos de respuesta del asesor por mensaje, sin Headline ni etapa Nuevo; ganadas por la IA', async () => {
    const total = await fila('2026-11-16', null);
    expect(total?.leadsRecibidos).toBe(5);
    // K1: la IA ganó el primer mensaje y el asesor respondió el segundo en 2 min; K3 30; K4 20; K5 10.
    expect([...(total?.tiemposRespuesta ?? [])].sort((a, b) => a - b)).toEqual([2, 10, 20, 30]);
    expect(total?.respuestasIa).toBe(1); // K1 (K2 sigue en Nuevo: no se mide)
    expect(total?.respuestasEfectivas).toBe(1); // K1: 2 min y el cliente volvió a escribir
    const u1 = await fila('2026-11-16', 'U1');
    expect(u1?.leadsRecibidos).toBe(2);
    expect(u1?.tiemposRespuesta).toEqual([2]);
    expect((await fila('2026-11-16', 'U3'))?.tiemposRespuesta).toEqual([10]);
  });

  it('fotos al cierre: el lead respondido por la IA no queda sin responder; el perdido no cuenta', async () => {
    const martes = await fila('2026-11-17', null);
    expect(martes?.fotoSinResponder).toBe(0);
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
    expect(k1?.minutosLaboralesRespuesta).toBe(2);
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

  it('tiempo corrido: el recálculo pendiente mide en tiempo de reloj y borra la marca', async () => {
    await db
      .update(tablas.subcuentas)
      .set({ horarioGeneral: { modo: 'corrido', recalcularDesde: '2026-11-16' } })
      .where(eq(tablas.subcuentas.locationId, LOC));
    expect(await recalcularPendientes(db, L(17, '18:30'))).toBe(1);
    // K3: lunes 10:00 → martes 11:00 son 25 h de reloj = 1,04 días (en horario laboral eran 1,125).
    expect((await fila('2026-11-17', 'U2'))?.sumaDiasCierre).toBeCloseTo(25 / 24);
    const [s] = await db
      .select()
      .from(tablas.subcuentas)
      .where(eq(tablas.subcuentas.locationId, LOC));
    expect(s?.horarioGeneral).toEqual({ modo: 'corrido' });
    // Sin marca no vuelve a recalcular.
    expect(await recalcularPendientes(db, L(17, '18:30'))).toBe(0);
  });
});
