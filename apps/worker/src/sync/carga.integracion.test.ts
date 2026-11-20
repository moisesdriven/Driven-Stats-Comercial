/**
 * Carga completa contra un GHL simulado y PostgreSQL desechable (nunca tokens reales).
 * Usa su propia base (<DATABASE_URL_TEST>_worker) para no chocar con las pruebas de la web.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import { baseWorker } from '../pruebas/base';
import {
  ClienteGhl,
  Limitador,
  crearGhlSimulado,
  type DatosSimulados,
  type MensajeGhl,
  type OportunidadGhl,
} from '@driven/ghl';
import { ejecutarCarga, marcarHistoricoSolicitado, necesitaHistoricoInicial } from './ejecutar';
import { recalcularVentas } from './oportunidades';

const URL = process.env.DATABASE_URL_TEST;
const LOC = 'LOC_JADE_SIM';
const AHORA = new Date('2026-11-10T20:00:00Z');
const h = (hhmm: string, dia = 10) => `2026-11-${dia}T${hhmm}:00.000Z`;

const PIPELINE = {
  id: 'P1',
  name: 'Flujo Comercial',
  stages: [
    { id: 'S_NUEVO', name: 'Nuevo' },
    { id: 'S_CONT', name: 'Contactado' },
    { id: 'S_COT', name: 'Cotizado' },
    { id: 'S_ADEL', name: 'Adelanto' },
    { id: 'S_PAGO', name: 'Pago Completo' },
  ],
};

const m = (
  id: string,
  contacto: string,
  fecha: string,
  extra: Partial<MensajeGhl>,
): MensajeGhl => ({
  id,
  locationId: LOC,
  contactId: contacto,
  conversationId: `conv_${contacto}`,
  dateAdded: fecha,
  direction: 'outbound',
  messageType: 'TYPE_WHATSAPP',
  ...extra,
});
const entrante = (id: string, c: string, f: string) =>
  m(id, c, f, { direction: 'inbound', body: 'Hola, quiero info' });
const actividad = (
  id: string,
  c: string,
  f: string,
  opp: string,
  anterior: string | null,
  nueva: string,
) =>
  m(id, c, f, {
    messageType: 'TYPE_ACTIVITY_OPPORTUNITY',
    source: 'app',
    activity: {
      type: anterior ? 'opportunity_stage_updated' : 'opportunity_created',
      data: {
        id: opp,
        status: 'open',
        pipeline: 'Flujo Comercial',
        stage: { ...(anterior ? { oldStageName: anterior } : {}), newStageName: nueva },
      },
    },
  });

function datos(): DatosSimulados {
  const oportunidades: OportunidadGhl[] = [
    {
      id: 'O1',
      contactId: 'K1',
      pipelineId: 'P1',
      pipelineStageId: 'S_ADEL',
      status: 'open',
      assignedTo: 'U1',
      monetaryValue: 1500,
      source: 'Meta Ads',
      createdAt: h('09:59'),
      lastStageChangeAt: h('12:00'),
      lastStatusChangeAt: h('09:59'),
    },
    {
      id: 'O2',
      contactId: 'K2',
      pipelineId: 'P1',
      pipelineStageId: 'S_CONT',
      status: 'lost',
      assignedTo: 'U2',
      lostReasonId: 'MP1',
      createdAt: h('11:00'),
      lastStageChangeAt: h('11:00'),
      lastStatusChangeAt: h('15:00'),
    },
  ];
  return {
    locationId: LOC,
    token: 'pit-simulado',
    nombre: 'Jade simulada',
    usuarios: [
      { id: 'U1', name: 'Asesora Uno' },
      { id: 'U2', name: 'Asesora Dos' },
    ],
    pipelines: [PIPELINE],
    motivos: [{ id: 'MP1', name: 'Sin presupuesto' }],
    conversaciones: [
      {
        id: 'conv_K1',
        contactId: 'K1',
        locationId: LOC,
        assignedTo: 'U1',
        dateAdded: Date.parse(h('10:00')),
        lastMessageDate: Date.parse(h('12:00')),
      },
      {
        id: 'conv_K2',
        contactId: 'K2',
        locationId: LOC,
        assignedTo: 'U2',
        dateAdded: Date.parse(h('11:00')),
        lastMessageDate: Date.parse(h('11:01')),
      },
      {
        id: 'conv_K3',
        contactId: 'K3',
        locationId: LOC,
        assignedTo: 'U2',
        dateAdded: Date.parse(h('13:00')),
        lastMessageDate: Date.parse(h('13:00')),
      },
      // Cliente antiguo: la conversación existe desde mucho antes de la carga.
      {
        id: 'conv_K4',
        contactId: 'K4',
        locationId: LOC,
        assignedTo: 'U1',
        dateAdded: Date.parse('2026-09-01T10:00:00Z'),
        lastMessageDate: Date.parse(h('14:00')),
      },
    ],
    mensajes: [
      entrante('k1-1', 'K1', h('10:00')),
      m('k1-2', 'K1', h('10:01'), { source: 'workflow', userId: 'U1', body: 'Bienvenido' }),
      m('k1-3', 'K1', h('10:02'), { source: 'app', userId: 'U1', body: 'Te paso con una asesora' }), // IA
      m('k1-4', 'K1', h('10:30'), { source: 'app', userId: 'U1', body: 'Hola, soy tu asesora' }), // humana
      m('k1-5', 'K1', h('11:00'), {
        source: 'app',
        userId: 'U1',
        body: '',
        attachments: ['https://x/foto.jpg'],
      }), // humana, imagen
      entrante('k2-1', 'K2', h('11:00')),
      m('k2-2', 'K2', h('11:01'), { source: 'app', userId: 'U2', body: 'Respuesta IA' }), // IA
      entrante('k3-1', 'K3', h('13:00')),
      entrante('k4-1', 'K4', h('14:00')),
      m('k4-2', 'K4', h('14:05'), { source: 'app', userId: 'U1', body: 'Falla de GHL' }), // generations falla
      actividad('a1', 'K1', h('09:59'), 'O1', null, 'Nuevo'),
      actividad('a2', 'K1', h('10:31'), 'O1', 'Nuevo', 'Contactado'),
      actividad('a3', 'K1', h('11:00'), 'O1', 'Contactado', 'Cotizado'),
      actividad('a4', 'K1', h('12:00'), 'O1', 'Cotizado', 'Adelanto'),
    ],
    generadosPorIa: new Set(['k1-3', 'k2-2']),
    oportunidades,
    tareas: [{ id: 'T1', contactId: 'K1', dueDate: h('18:00'), completed: false }],
  };
}

describe.skipIf(!URL)('carga desde GHL (integración con GHL simulado)', () => {
  let db: Db;
  const d = datos();
  const sim = crearGhlSimulado(d);
  let cliente: ClienteGhl;
  // generations de k4-2 responde 503 (más veces que los reintentos) hasta que se apague la falla.
  let fallaActiva = true;

  beforeAll(async () => {
    db = await baseWorker();
    const sinEspera = async () => {};
    const fetchConFalla: typeof fetch = async (u, init) => {
      const url = new globalThis.URL(String(u));
      if (
        url.pathname === '/conversation-ai/generations' &&
        url.searchParams.get('messageId') === 'k4-2' &&
        fallaActiva
      ) {
        return new Response('{"message":"caído"}', { status: 503 });
      }
      return sim.fetch(u, init);
    };
    cliente = new ClienteGhl({
      token: 'pit-simulado',
      locationId: LOC,
      fetch: fetchConFalla,
      limitador: new Limitador(10_000, 10_000, sinEspera),
      esperar: sinEspera,
      reintentosMax: 1,
    });
    await db.insert(tablas.subcuentas).values({ locationId: LOC, nombre: 'Jade simulada' });
    // El mapa lo define la configuración (decisión del cliente para Jade18K).
    await ejecutarCarga(db, cliente, 'incremental', {
      modo: 'sombra',
      ahora: new Date('2026-11-01T00:00:00Z'),
    });
    for (const [stageId, etapa] of [
      ['S_NUEVO', 'nuevo'],
      ['S_CONT', 'contactado'],
      ['S_COT', 'por_cerrar'],
      ['S_ADEL', 'ganado'],
      ['S_PAGO', 'ganado'],
    ] as const) {
      await db
        .update(tablas.mapaEtapas)
        .set({ etapaEstandar: etapa })
        .where(eq(tablas.mapaEtapas.stageId, stageId));
    }
    await ejecutarCarga(db, cliente, 'historico', { modo: 'sombra', dias: 2, ahora: AHORA });
  });

  it('clasifica el origen de cada mensaje según el mapeo aprobado', async () => {
    const filas = await db.select().from(tablas.mensajes);
    const origen = Object.fromEntries(filas.map((f) => [f.messageId, f.origen]));
    expect(origen['k1-1']).toBeNull();
    expect(origen['k1-2']).toBe('workflow');
    expect(origen['k1-3']).toBe('agente_ia');
    expect(origen['k1-4']).toBe('manual');
    expect(origen['k2-2']).toBe('agente_ia');
    expect(origen['k4-2']).toBe('sin_origen'); // GHL falló: no se cuenta como humano
    expect(filas.find((f) => f.messageId === 'k1-5')?.contenido).toBe('imagen');
    expect(filas.some((f) => f.messageId.startsWith('a'))).toBe(false); // actividades no son mensajes
  });

  it('separa la primera respuesta automática de la humana', async () => {
    const [k1] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K1'));
    expect(k1?.ingresoEn?.toISOString()).toBe(h('10:00'));
    expect(k1?.primeraRespAutoEn?.toISOString()).toBe(h('10:01'));
    expect(k1?.primeraRespHumanaEn?.toISOString()).toBe(h('10:30'));
    expect(k1?.primeraRespHumanaPor).toBe('U1');
    expect(k1?.asesorId).toBe('U1');
    expect(k1?.campana).toBe('Meta Ads');
    const [k2] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K2'));
    expect(k2?.primeraRespHumanaEn).toBeNull(); // solo respondió la IA
  });

  it('reconstruye el historial de etapas desde las actividades y detecta la venta', async () => {
    const hist = await db
      .select()
      .from(tablas.historialEtapas)
      .where(eq(tablas.historialEtapas.opportunityId, 'O1'))
      .orderBy(tablas.historialEtapas.desde);
    expect(hist.map((x) => x.stageId)).toEqual(['S_NUEVO', 'S_CONT', 'S_COT', 'S_ADEL']);
    expect(hist.at(-1)?.hasta).toBeNull();
    const [o1] = await db
      .select()
      .from(tablas.oportunidades)
      .where(eq(tablas.oportunidades.opportunityId, 'O1'));
    expect(o1?.ventaEn?.toISOString()).toBe(h('12:00'));
    const ventas = await db
      .select()
      .from(tablas.eventos)
      .where(and(eq(tablas.eventos.tipo, 'venta'), eq(tablas.eventos.opportunityId, 'O1')));
    expect(ventas).toHaveLength(1);
    expect(ventas[0]?.asesorId).toBe('U1');
    const [k1] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K1'));
    expect(k1?.estado).toBe('ganado');
  });

  it('un lead con oportunidad perdida queda perdido, con su motivo', async () => {
    const [k2] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K2'));
    expect(k2?.estado).toBe('perdido');
    const [p] = await db
      .select()
      .from(tablas.eventos)
      .where(and(eq(tablas.eventos.tipo, 'perdida'), eq(tablas.eventos.opportunityId, 'O2')));
    expect(p?.datos).toMatchObject({ motivo: 'MP1' });
    const motivos = await db.select().from(tablas.motivosPerdida);
    expect(motivos[0]?.nombre).toBe('Sin presupuesto');
  });

  it('sin oportunidad, el asesor es el asignado a la conversación', async () => {
    const [k3] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K3'));
    expect(k3?.asesorId).toBe('U2');
    expect(k3?.estado).toBe('abierto');
  });

  it('un cliente antiguo no cuenta como lead nuevo del periodo', async () => {
    const [k4] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K4'));
    expect(k4?.ingresoAnteriorACarga).toBe(true);
    const eventosK4 = await db
      .select()
      .from(tablas.eventos)
      .where(and(eq(tablas.eventos.contactId, 'K4'), eq(tablas.eventos.tipo, 'lead_recibido')));
    expect(eventosK4).toHaveLength(0);
  });

  it('registra la asignación de cada oportunidad nueva y las tareas', async () => {
    const asign = await db
      .select()
      .from(tablas.eventos)
      .where(eq(tablas.eventos.tipo, 'asignacion'));
    expect(asign.map((a) => a.opportunityId).sort()).toEqual(['O1', 'O2']);
    expect((await db.select().from(tablas.tareas)).length).toBe(1);
  });

  it('es idempotente: repetir la carga no duplica nada', async () => {
    const contar = async () => ({
      eventos: (await db.select().from(tablas.eventos)).length,
      mensajes: (await db.select().from(tablas.mensajes)).length,
      historial: (await db.select().from(tablas.historialEtapas)).length,
      leads: (await db.select().from(tablas.leads)).length,
    });
    const antes = await contar();
    await ejecutarCarga(db, cliente, 'historico', { modo: 'sombra', dias: 2, ahora: AHORA });
    expect(await contar()).toEqual(antes);
  });

  it('la incremental detecta una venta cancelada y la nocturna reintenta orígenes pendientes', async () => {
    // O1 vuelve de Adelanto a Cotizado.
    const o1 = d.oportunidades!.find((o) => o.id === 'O1')!;
    o1.pipelineStageId = 'S_COT';
    o1.lastStageChangeAt = h('19:00');
    d.mensajes!.push(entrante('k1-6', 'K1', h('19:01')));
    d.conversaciones!.find((c) => c.id === 'conv_K1')!.lastMessageDate = Date.parse(h('19:01'));
    await ejecutarCarga(db, cliente, 'incremental', {
      modo: 'sombra',
      ahora: new Date('2026-11-10T19:30:00Z'),
    });

    const [o] = await db
      .select()
      .from(tablas.oportunidades)
      .where(eq(tablas.oportunidades.opportunityId, 'O1'));
    expect(o?.ventaCanceladaEn?.toISOString()).toBe(h('19:00'));
    const canc = await db
      .select()
      .from(tablas.eventos)
      .where(
        and(eq(tablas.eventos.tipo, 'venta_cancelada'), eq(tablas.eventos.opportunityId, 'O1')),
      );
    expect(canc).toHaveLength(1);
    const [k1] = await db.select().from(tablas.leads).where(eq(tablas.leads.contactId, 'K1'));
    expect(k1?.estado).toBe('abierto');

    fallaActiva = false;
    await ejecutarCarga(db, cliente, 'nocturno', {
      modo: 'sombra',
      ahora: new Date('2026-11-11T07:30:00Z'),
    });
    const [k42] = await db
      .select()
      .from(tablas.mensajes)
      .where(eq(tablas.mensajes.messageId, 'k4-2'));
    expect(k42?.origen).toBe('manual');
  });

  it('un cambio del mapa de etapas recalcula las ventas pasadas', async () => {
    await db
      .update(tablas.mapaEtapas)
      .set({ etapaEstandar: 'ganado' })
      .where(eq(tablas.mapaEtapas.stageId, 'S_COT'));
    await recalcularVentas(db, LOC);
    const [o] = await db
      .select()
      .from(tablas.oportunidades)
      .where(eq(tablas.oportunidades.opportunityId, 'O1'));
    // Con Cotizado como "ganado", la venta empieza a las 11:00 y nunca se cancela.
    expect(o?.ventaEn?.toISOString()).toBe(h('11:00'));
    expect(o?.ventaCanceladaEn).toBeNull();
  });

  it('registra cada ejecución con su resumen y sus llamadas', async () => {
    const ej = await db.select().from(tablas.syncEjecuciones);
    expect(ej.every((e) => e.estado === 'ok')).toBe(true);
    expect(ej.every((e) => e.llamadas > 0)).toBe(true);
  });

  it('no avanza la carga histórica si GHL responde vacío un día con conversaciones activas', async () => {
    // Falla real del 16 nov 2026: la exportación respondió `total: 0` durante varios minutos.
    const dia11 = (hhmm: string) => h(hhmm, 11);
    const base = datos();
    const datosFalla: DatosSimulados = {
      ...base,
      conversaciones: [
        ...(base.conversaciones ?? []),
        {
          id: 'conv_K5',
          contactId: 'K5',
          locationId: LOC,
          assignedTo: 'U1',
          dateAdded: Date.parse(dia11('10:00')),
          lastMessageDate: Date.parse(dia11('10:00')),
        },
      ],
      mensajes: [...(base.mensajes ?? []), entrante('k5-1', 'K5', dia11('10:00'))],
    };
    const simFalla = crearGhlSimulado({ ...datosFalla, exportacionesEnCero: 99 });
    const sinEspera = async () => {};
    const opciones = {
      token: 'pit-simulado',
      locationId: LOC,
      limitador: new Limitador(10_000, 10_000, sinEspera),
      esperar: sinEspera,
      reintentosMax: 1,
    };
    const conFalla = new ClienteGhl({ ...opciones, fetch: simFalla.fetch });
    const manana = new Date('2026-11-11T20:00:00Z');
    const marcaAntes = await db
      .select()
      .from(tablas.syncEstado)
      .where(
        and(eq(tablas.syncEstado.locationId, LOC), eq(tablas.syncEstado.recurso, 'historico')),
      );

    await expect(
      ejecutarCarga(db, conFalla, 'historico', { modo: 'sombra', dias: 2, ahora: manana }),
    ).rejects.toThrow(/0 mensajes/);
    const [marca] = await db
      .select()
      .from(tablas.syncEstado)
      .where(
        and(eq(tablas.syncEstado.locationId, LOC), eq(tablas.syncEstado.recurso, 'historico')),
      );
    expect(marca?.marcaAgua).toEqual(marcaAntes[0]?.marcaAgua);
    expect(marca?.ultimoError).toMatch(/0 mensajes/);

    // Cuando GHL se recupera, la siguiente carga reanuda el día y trae el mensaje.
    const sano = new ClienteGhl({ ...opciones, fetch: crearGhlSimulado(datosFalla).fetch });
    await ejecutarCarga(db, sano, 'historico', { modo: 'sombra', dias: 2, ahora: manana });
    const k5 = await db.select().from(tablas.mensajes).where(eq(tablas.mensajes.messageId, 'k5-1'));
    expect(k5).toHaveLength(1);
  });

  it('la exportación atrasada de GHL no hace perder mensajes (17 nov 2026)', async () => {
    const ocultos = new Set(['k1-7', 'k2-9']);
    d.ocultosEnExportacion = ocultos;
    // K1: la asesora responde a las 08:00; la exportación todavía no lo trae, la conversación sí.
    d.mensajes!.push(
      m('k1-7', 'K1', h('08:00', 11), {
        source: 'app',
        userId: 'U1',
        body: 'Le comparto el precio',
      }),
    );
    d.conversaciones!.find((c) => c.id === 'conv_K1')!.lastMessageDate = Date.parse(h('08:00', 11));
    // K2: un mensaje de las 05:00 que tampoco sale en la conversación reciente (su fecha de último
    // mensaje no cambió) y aparece tarde en la exportación.
    d.mensajes!.push(entrante('k2-9', 'K2', h('05:00', 11)));
    const buscar = async (id: string) =>
      db.select().from(tablas.mensajes).where(eq(tablas.mensajes.messageId, id));

    await ejecutarCarga(db, cliente, 'incremental', {
      modo: 'sombra',
      ahora: new Date('2026-11-11T08:10:00Z'),
    });
    const [k17] = await buscar('k1-7');
    expect(k17?.origen).toBe('manual');
    expect(await buscar('k2-9')).toHaveLength(0);

    // La exportación se pone al día con 3 h de atraso: la siguiente pasada revisa las últimas 24 h.
    ocultos.clear();
    await ejecutarCarga(db, cliente, 'incremental', {
      modo: 'sombra',
      ahora: new Date('2026-11-11T08:25:00Z'),
    });
    expect(await buscar('k2-9')).toHaveLength(1);
    expect(await buscar('k1-7')).toHaveLength(1);
  });
  it('la primera carga de una subcuenta es la histórica de 90 días, y se pide una sola vez', async () => {
    const NUEVA = 'LOC_NUEVA_SIM';
    const t0 = new Date('2026-11-20T15:00:00Z');
    // Sin ninguna histórica terminada: hay que pedirla.
    expect(await necesitaHistoricoInicial(db, NUEVA, t0)).toBe(true);
    // Pedida: no se vuelve a pedir mientras está en cola o en curso…
    await marcarHistoricoSolicitado(db, NUEVA);
    expect(await necesitaHistoricoInicial(db, NUEVA, new Date())).toBe(false);
    // …salvo que pasen más de 6 h sin terminarla (se reintenta).
    expect(await necesitaHistoricoInicial(db, NUEVA, new Date(Date.now() + 7 * 3600_000))).toBe(
      true,
    );
    // La subcuenta simulada ya tiene su histórica terminada: no se pide otra.
    expect(await necesitaHistoricoInicial(db, LOC, new Date(Date.now() + 7 * 3600_000))).toBe(
      false,
    );
  });
});
