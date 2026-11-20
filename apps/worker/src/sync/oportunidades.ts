/**
 * Oportunidades, historial de etapas y eventos (docs/mapeo-origen.md §5).
 * - Cada carga compara con lo guardado: cambio de etapa → cierra el intervalo y abre otro.
 * - La carga histórica reconstruye el historial desde las actividades de cada conversación.
 * - Las ventas y cancelaciones se recalculan siempre desde el historial con el mapa vigente, así un
 *   cambio en el mapa de etapas corrige las ventas pasadas.
 */
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  intervalosDesdeActividades,
  transicionesOportunidad,
  type ActividadEtapa,
  type EstadoOportunidad,
  type EtapaEstandar,
  type FotoOportunidad,
} from '@driven/core';
import { tablas, type Db } from '@driven/db';
import {
  esConversacionInexistente,
  type ClienteGhl,
  type OportunidadGhl,
  type PipelineGhl,
} from '@driven/ghl';
import { cargarMapa } from './catalogos';
import { enLotes, enParalelo, fechaONula } from './util';

type Mapa = Awaited<ReturnType<typeof cargarMapa>>;

const estandar = (mapa: Mapa, stageId: string | null | undefined) =>
  (stageId ? (mapa.estandarPorEtapa.get(stageId) ?? null) : null) as EtapaEstandar | null;

async function insertarEvento(db: Db, e: typeof tablas.eventos.$inferInsert) {
  await db.insert(tablas.eventos).values(e).onConflictDoNothing({ target: tablas.eventos.clave });
}

export interface ResultadoOportunidades {
  oportunidades: number;
  cambiosEtapa: number;
  nuevas: number;
  ids: Set<string>;
}

/** Guarda una oportunidad leída de GHL y registra sus cambios respecto de la última lectura. */
async function guardarOportunidad(
  db: Db,
  loc: string,
  o: OportunidadGhl,
  mapa: Mapa,
  r: ResultadoOportunidades,
) {
  const [guardada] = await db
    .select()
    .from(tablas.oportunidades)
    .where(eq(tablas.oportunidades.opportunityId, o.id))
    .limit(1);
  let anterior: FotoOportunidad | null = null;
  if (guardada) {
    anterior = {
      status: guardada.status,
      stageId: guardada.stageId,
      etapaEstandar: estandar(mapa, guardada.stageId),
    };
  } else {
    const [ultimo] = await db
      .select()
      .from(tablas.historialEtapas)
      .where(
        and(eq(tablas.historialEtapas.opportunityId, o.id), isNull(tablas.historialEtapas.hasta)),
      )
      .orderBy(desc(tablas.historialEtapas.desde))
      .limit(1);
    if (ultimo)
      anterior = {
        status: 'open',
        stageId: ultimo.stageId,
        etapaEstandar: estandar(mapa, ultimo.stageId),
      };
  }

  const creada = fechaONula(o.createdAt) ?? new Date();
  const enEtapa = fechaONula(o.lastStageChangeAt) ?? creada;
  const enEstado = fechaONula(o.lastStatusChangeAt) ?? enEtapa;
  const actual: FotoOportunidad = {
    status: o.status as EstadoOportunidad,
    stageId: o.pipelineStageId ?? null,
    etapaEstandar: estandar(mapa, o.pipelineStageId),
  };
  // Aquí solo interesan etapa, pérdida y reapertura: las ventas se recalculan desde el historial.
  const { eventos } = transicionesOportunidad({
    anterior,
    actual,
    venta: { ventaEn: null, ventaCanceladaEn: null },
    enEtapa,
    enEstado,
  });

  const base = {
    locationId: loc,
    contactId: o.contactId ?? null,
    opportunityId: o.id,
    asesorId: o.assignedTo ?? null,
    fuente: 'carga' as const,
  };
  if (!guardada && !anterior) {
    r.nuevas++;
    await insertarEvento(db, {
      ...base,
      clave: `asignacion:${o.id}`,
      tipo: 'asignacion',
      ocurridoEn: creada,
      datos: { motivo: 'oportunidad_nueva' },
    });
  } else if (guardada?.asesorId && o.assignedTo && guardada.asesorId !== o.assignedTo) {
    const en = fechaONula(o.updatedAt) ?? new Date();
    await insertarEvento(db, {
      ...base,
      clave: `asignacion:${o.id}:${en.toISOString()}`,
      tipo: 'asignacion',
      ocurridoEn: en,
      datos: { motivo: 'reasignacion', anterior: guardada.asesorId },
    });
  }

  for (const e of eventos) {
    if (e.tipo === 'cambio_etapa') {
      r.cambiosEtapa++;
      await insertarEvento(db, {
        ...base,
        clave: `etapa:${o.id}:${e.hacia}:${e.en.toISOString()}`,
        tipo: 'cambio_etapa',
        ocurridoEn: e.en,
        datos: { desde: e.desde, hacia: e.hacia },
      });
      // Historial: cierra el intervalo abierto y abre el nuevo.
      await db
        .update(tablas.historialEtapas)
        .set({ hasta: e.en })
        .where(
          and(eq(tablas.historialEtapas.opportunityId, o.id), isNull(tablas.historialEtapas.hasta)),
        );
      if (e.hacia) {
        await db.insert(tablas.historialEtapas).values({
          opportunityId: o.id,
          locationId: loc,
          contactId: o.contactId ?? null,
          stageId: e.hacia,
          etapaEstandar: actual.etapaEstandar,
          desde: e.en,
          fuente: 'carga',
        });
      }
    } else if (e.tipo === 'perdida') {
      await insertarEvento(db, {
        ...base,
        clave: `perdida:${o.id}:${e.en.toISOString()}`,
        tipo: 'perdida',
        ocurridoEn: e.en,
        datos: { etapa: e.etapa, motivo: o.lostReasonId ?? null, estado: o.status },
      });
    } else if (e.tipo === 'reapertura') {
      await insertarEvento(db, {
        ...base,
        clave: `reapertura:${o.id}:${e.en.toISOString()}`,
        tipo: 'reapertura',
        ocurridoEn: e.en,
        datos: {},
      });
    }
  }

  const perdida = o.status === 'lost' || o.status === 'abandoned';
  const fila = {
    opportunityId: o.id,
    locationId: loc,
    contactId: o.contactId ?? null,
    pipelineId: o.pipelineId ?? null,
    stageId: o.pipelineStageId ?? null,
    status: actual.status,
    monto: o.monetaryValue ?? null,
    creadaEn: creada,
    cambioEstadoEn: enEstado,
    cambioEtapaEn: enEtapa,
    motivoPerdida: o.lostReasonId ?? null,
    asesorId: o.assignedTo ?? null,
    fuente: o.source || null,
    etapaEstandar: actual.etapaEstandar,
    perdidaEn: perdida ? (guardada?.perdidaEn ?? enEstado) : null,
    etapaPerdida: perdida ? (guardada?.etapaPerdida ?? actual.stageId) : null,
  };
  await db
    .insert(tablas.oportunidades)
    .values(fila)
    .onConflictDoUpdate({ target: tablas.oportunidades.opportunityId, set: fila });
  r.oportunidades++;
  r.ids.add(o.id);
}

/** Carga todas las oportunidades (o las de ciertos contactos). */
export async function cargarOportunidades(
  db: Db,
  cliente: ClienteGhl,
  p: { contactIds?: string[] } = {},
): Promise<ResultadoOportunidades> {
  const mapa = await cargarMapa(db, cliente.locationId);
  const r: ResultadoOportunidades = {
    oportunidades: 0,
    cambiosEtapa: 0,
    nuevas: 0,
    ids: new Set(),
  };
  const procesar = async (lote: OportunidadGhl[]) => {
    for (const o of lote) await guardarOportunidad(db, cliente.locationId, o, mapa, r);
  };
  if (p.contactIds) {
    await enParalelo(p.contactIds, 4, async (contactId) => {
      for await (const lote of cliente.oportunidades({ contactId })) await procesar(lote);
    });
  } else {
    for await (const lote of cliente.oportunidades()) await procesar(lote);
  }
  return r;
}

/**
 * Reconstruye el historial de etapas desde las actividades de oportunidad (carga histórica). Las
 * actividades traen las etapas por nombre: se traducen a stageId con el pipeline.
 */
export async function reconstruirHistorial(
  db: Db,
  cliente: ClienteGhl,
  conversationIds: string[],
  pipelines: PipelineGhl[],
): Promise<{
  actividades: number;
  oportunidades: number;
  sinTraducir: number;
  conversacionesInexistentes: number;
}> {
  const pipelinePorNombre = new Map(pipelines.map((p) => [p.name.trim().toLowerCase(), p]));
  const actividades: (ActividadEtapa & { contactId: string | null; pipelineId: string | null })[] =
    [];
  let inexistentes = 0;
  await enParalelo(conversationIds, 4, async (cid) => {
    try {
      for await (const lote of cliente.mensajesConversacion(cid, 'TYPE_ACTIVITY_OPPORTUNITY')) {
        for (const m of lote) {
          const d = m.activity?.data;
          if (!d?.id || !d.stage) continue;
          const pipeline = pipelinePorNombre.get((d.pipeline ?? '').trim().toLowerCase()) ?? null;
          actividades.push({
            opportunityId: d.id,
            en: new Date(m.dateAdded),
            etapaAnterior: d.stage.oldStageName ?? null,
            etapaNueva: d.stage.newStageName ?? null,
            contactId: m.contactId ?? null,
            pipelineId: pipeline?.id ?? null,
          });
        }
      }
    } catch (e) {
      // Conversación eliminada o fusionada en GHL (la búsqueda aún la lista): se salta.
      if (!esConversacionInexistente(e)) throw e;
      inexistentes++;
    }
  });

  let sinTraducir = 0;
  const intervalos = intervalosDesdeActividades(actividades);
  const infoOpp = new Map(actividades.map((a) => [a.opportunityId, a]));
  const filas: (typeof tablas.historialEtapas.$inferInsert)[] = [];
  for (const i of intervalos) {
    const info = infoOpp.get(i.opportunityId);
    const pipeline = info?.pipelineId ? pipelines.find((p) => p.id === info.pipelineId) : undefined;
    const etapa = pipeline?.stages.find(
      (s) => s.name.trim().toLowerCase() === i.etapa.trim().toLowerCase(),
    );
    if (!etapa) {
      sinTraducir++;
      continue;
    }
    filas.push({
      opportunityId: i.opportunityId,
      locationId: cliente.locationId,
      contactId: info?.contactId ?? null,
      stageId: etapa.id,
      desde: i.desde,
      hasta: i.hasta,
      fuente: 'actividad',
    });
  }
  const opps = [...new Set(filas.map((f) => f.opportunityId))];
  for (const parte of enLotes(opps, 500)) {
    await db
      .delete(tablas.historialEtapas)
      .where(inArray(tablas.historialEtapas.opportunityId, parte));
  }
  for (const parte of enLotes(filas, 500))
    if (parte.length) await db.insert(tablas.historialEtapas).values(parte);
  for (const f of filas) {
    await insertarEvento(db, {
      clave: `etapa:${f.opportunityId}:${f.stageId}:${f.desde.toISOString()}`,
      locationId: cliente.locationId,
      contactId: f.contactId ?? null,
      opportunityId: f.opportunityId,
      tipo: 'cambio_etapa',
      ocurridoEn: f.desde,
      datos: { hacia: f.stageId },
      fuente: 'actividad',
    });
  }
  return {
    actividades: actividades.length,
    oportunidades: opps.length,
    sinTraducir,
    conversacionesInexistentes: inexistentes,
  };
}

/**
 * Recalcula ventas y cancelaciones desde el historial de etapas y el estado actual, con el mapa
 * vigente. Reemplaza los eventos `venta`/`venta_cancelada` de esas oportunidades.
 */
export async function recalcularVentas(
  db: Db,
  locationId: string,
  ids?: string[],
): Promise<{ ventas: number; canceladas: number }> {
  const mapa = await cargarMapa(db, locationId);
  const opps = await db
    .select()
    .from(tablas.oportunidades)
    .where(
      ids
        ? and(
            eq(tablas.oportunidades.locationId, locationId),
            inArray(tablas.oportunidades.opportunityId, ids.length ? ids : ['-']),
          )
        : eq(tablas.oportunidades.locationId, locationId),
    );
  let ventas = 0;
  let canceladas = 0;
  for (const parte of enLotes(opps, 500)) {
    const historial = await db
      .select()
      .from(tablas.historialEtapas)
      .where(
        inArray(
          tablas.historialEtapas.opportunityId,
          parte.map((o) => o.opportunityId),
        ),
      )
      .orderBy(tablas.historialEtapas.desde);
    for (const o of parte) {
      const intervalos = historial.filter((h) => h.opportunityId === o.opportunityId);
      let anterior: FotoOportunidad | null = null;
      let venta = { ventaEn: null as Date | null, ventaCanceladaEn: null as Date | null };
      const eventos: { tipo: 'venta' | 'venta_cancelada'; en: Date }[] = [];
      const aplicar = (actual: FotoOportunidad, enEtapa: Date, enEstado: Date) => {
        const t = transicionesOportunidad({ anterior, actual, venta, enEtapa, enEstado });
        for (const e of t.eventos)
          if (e.tipo === 'venta' || e.tipo === 'venta_cancelada')
            eventos.push({ tipo: e.tipo, en: e.en });
        venta = t.venta;
        anterior = actual;
      };
      for (const h of intervalos)
        aplicar(
          { status: 'open', stageId: h.stageId, etapaEstandar: estandar(mapa, h.stageId) },
          h.desde,
          h.desde,
        );
      const final: FotoOportunidad = {
        status: o.status,
        stageId: o.stageId,
        etapaEstandar: estandar(mapa, o.stageId),
      };
      aplicar(
        final,
        o.cambioEtapaEn ?? o.creadaEn ?? new Date(),
        o.cambioEstadoEn ?? o.cambioEtapaEn ?? new Date(),
      );

      await db
        .delete(tablas.eventos)
        .where(
          and(
            eq(tablas.eventos.opportunityId, o.opportunityId),
            inArray(tablas.eventos.tipo, ['venta', 'venta_cancelada']),
          ),
        );
      for (const e of eventos) {
        await insertarEvento(db, {
          clave: `${e.tipo}:${o.opportunityId}:${e.en.toISOString()}`,
          locationId,
          contactId: o.contactId,
          opportunityId: o.opportunityId,
          tipo: e.tipo,
          ocurridoEn: e.en,
          asesorId: o.asesorId,
          datos: e.tipo === 'venta' ? { monto: o.monto } : {},
          fuente: 'calculo',
        });
        if (e.tipo === 'venta') ventas++;
        else canceladas++;
      }
      await db
        .update(tablas.oportunidades)
        .set({
          ventaEn: venta.ventaEn,
          ventaCanceladaEn: venta.ventaCanceladaEn,
          etapaEstandar: estandar(mapa, o.stageId),
        })
        .where(eq(tablas.oportunidades.opportunityId, o.opportunityId));
    }
  }
  await db.execute(sql`select 1`);
  return { ventas, canceladas };
}
