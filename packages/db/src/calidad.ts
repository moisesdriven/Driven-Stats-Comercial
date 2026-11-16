/**
 * Análisis de calidad (§6) — parte con base de datos, compartida por la web (estimación previa al
 * botón) y el worker (preparación y envío). El envío a la Batches API vive en el worker.
 */
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gte, inArray, notInArray, sql } from 'drizzle-orm';
import {
  FORMATO_SALIDA_VIGENTE,
  TOKENS_MARGEN_PENSAMIENTO,
  esquemaRespuestaCalidad,
  instruccionesCalidad,
  VERSION_RUBRICA,
  estimarCosto,
  maxTokensPara,
  muestraEstratificada,
  recortarContexto,
  separarSaludos,
  seleccionarMensajes,
  textoConversacion,
  tokensAproximados,
  type EstimacionCosto,
  type EtiquetaCalidad,
  type FormatoSalida,
  type MensajeCalidad,
} from '@driven/core';
import type { Db } from './cliente';
import { analisisCalidad } from './esquema/index';

export type EsfuerzoIa = 'low' | 'medium' | 'high';

/** Cómo razona el modelo al calificar: esfuerzo y pensamiento adaptativo (activo o no). */
export interface AjustesIa {
  esfuerzo: EsfuerzoIa;
  pensamiento: boolean;
}

export const AJUSTES_IA_POR_DEFECTO: AjustesIa = { esfuerzo: 'low', pensamiento: false };

export interface ConfiguracionCalidad {
  modelo: string;
  ajustes: AjustesIa;
  tamanoMuestra: number;
  maxMensajesConversacion: number;
  minimoPorAsesor: number;
  topeMensualUsd: number;
  maxManualesMes: number;
  /** Saludos sueltos calificados por regla, sin IA (`CALIDAD_SALUDOS_POR_REGLA`, por defecto sí). */
  saludosPorRegla: boolean;
}

export function configuracionCalidad(env: NodeJS.ProcessEnv = process.env): ConfiguracionCalidad {
  const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    modelo: env.IA_MODELO || 'claude-haiku-5-5',
    ajustes: leerAjustesIa(env.IA_ESFUERZO, env.IA_PENSAMIENTO),
    tamanoMuestra: n(env.CALIDAD_MUESTRA_CONVERSACIONES, 1000),
    maxMensajesConversacion: n(env.CALIDAD_MAX_MENSAJES_CONVERSACION, 10),
    minimoPorAsesor: 20,
    topeMensualUsd: n(env.IA_TOPE_MENSUAL_USD, 10),
    maxManualesMes: n(env.CALIDAD_MAX_MANUALES_MES, 3),
    saludosPorRegla: !['no', 'false', '0'].includes(
      (env.CALIDAD_SALUDOS_POR_REGLA ?? 'si').toLowerCase(),
    ),
  };
}

/** Lee esfuerzo (low | medium | high) y pensamiento (si | no); valores desconocidos → por defecto. */
export function leerAjustesIa(esfuerzo?: string, pensamiento?: string): AjustesIa {
  const e = (['low', 'medium', 'high'] as const).find((x) => x === esfuerzo);
  return {
    esfuerzo: e ?? AJUSTES_IA_POR_DEFECTO.esfuerzo,
    pensamiento: pensamiento
      ? ['si', 'sí', 'true', '1'].includes(pensamiento.toLowerCase())
      : false,
  };
}

export interface Universo {
  /** Conversaciones elegibles por asesor (el que más mensajes `manual` escribió en ellas). */
  porAsesor: Map<string, string[]>;
  conversaciones: number;
  descartes: { sinOrigen: number; fueraDeEtapas: number };
}

/**
 * Universo elegible (§6.1): conversaciones con al menos un saliente `manual` dentro del periodo y
 * enviado mientras la oportunidad del contacto estaba en una de las 3 etapas de calidad
 * (según `historial_etapas`).
 */
export async function universoCalidad(
  db: Db,
  locationId: string,
  etapas: readonly string[],
  desde: Date,
  hasta: Date,
): Promise<Universo> {
  const etapasSql = sql.join(
    etapas.map((e) => sql`${e}`),
    sql`, `,
  );
  const r = await db.execute<{ conversation_id: string; asesor: string | null }>(sql`
    with elegibles as (
      select distinct m.message_id, m.conversation_id, m.user_id
      from comercial.mensajes m
      join comercial.historial_etapas h
        on h.location_id = m.location_id and h.contact_id = m.contact_id
       and h.stage_id in (${etapasSql})
       and m.fecha >= h.desde and (h.hasta is null or m.fecha < h.hasta)
      where m.location_id = ${locationId} and m.origen = 'manual' and m.fecha >= ${desde} and m.fecha < ${hasta}
    )
    select conversation_id, mode() within group (order by user_id) as asesor
    from elegibles group by conversation_id`);
  const d = await db.execute<{ sin_origen: number; manuales: number; en_etapas: number }>(sql`
    select
      count(*) filter (where m.origen = 'sin_origen')::int as sin_origen,
      count(*) filter (where m.origen = 'manual')::int as manuales,
      count(*) filter (where m.origen = 'manual' and exists (
        select 1 from comercial.historial_etapas h
        where h.location_id = m.location_id and h.contact_id = m.contact_id and h.stage_id in (${etapasSql})
          and m.fecha >= h.desde and (h.hasta is null or m.fecha < h.hasta)))::int as en_etapas
    from comercial.mensajes m
    where m.location_id = ${locationId} and m.direccion = 'outbound' and m.fecha >= ${desde} and m.fecha < ${hasta}`);
  const porAsesor = new Map<string, string[]>();
  for (const f of r.rows) {
    const a = f.asesor ?? 'sin_asesor';
    const lista = porAsesor.get(a) ?? [];
    lista.push(f.conversation_id);
    porAsesor.set(a, lista);
  }
  const c = d.rows[0] ?? { sin_origen: 0, manuales: 0, en_etapas: 0 };
  return {
    porAsesor,
    conversaciones: r.rows.length,
    descartes: { sinOrigen: c.sin_origen, fueraDeEtapas: c.manuales - c.en_etapas },
  };
}

export interface SolicitudPreparada {
  conversationId: string;
  asesorId: string;
  /** custom_id para la Batches API: ^[a-zA-Z0-9_-]{1,64}$ */
  customId: string;
  texto: string;
  numeracion: Record<number, string>;
  mensajes: number;
  tokensConversacion: number;
  /**
   * Saludos sueltos de la conversación calificados por regla (no van a la IA). Si `mensajes` es 0,
   * la conversación no se envía: todo lo elegido se calificó por regla.
   */
  porRegla: { messageId: string; etiqueta: EtiquetaCalidad }[];
  /** SHA-256 de lo que se enviaría a la IA (ver `huellaSolicitud`). */
  huella: string;
  /**
   * Calificación previa que se reutiliza (misma huella: misma rúbrica, modelo, ajustes y texto, sin
   * mensajes nuevos). Puede venir de otra conversación con el mismo texto; los mensajes se
   * emparejan por su número `n`. `null` = hay que enviarla.
   */
  reutilizarDe: CalificacionPrevia | null;
}

export interface CalificacionPrevia {
  analisisId: number;
  conversationId: string;
  numeracion: Record<string, string>;
}

/**
 * Huella de una solicitud: cambia si cambia cualquier cosa que reciba la IA (instrucciones,
 * esquema, modelo, ajustes o el texto de la conversación con sus mensajes numerados). Dos
 * solicitudes con la misma huella dan, en esencia, la misma calificación (§6 "sin trabajo repetido").
 */
export function huellaSolicitud(
  texto: string,
  modelo: string,
  ajustes: AjustesIa,
  formato: FormatoSalida = FORMATO_SALIDA_VIGENTE,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        VERSION_RUBRICA,
        instruccionesCalidad(formato),
        esquemaRespuestaCalidad(formato),
        modelo,
        ajustes.esfuerzo,
        ajustes.pensamiento,
        texto,
      ]),
    )
    .digest('hex');
}

/** Para cada huella, la calificación más reciente de la subcuenta en un análisis terminado. */
async function calificacionesPrevias(
  db: Db,
  locationId: string,
  huellas: string[],
  excluirAnalisisId: number | undefined,
): Promise<Map<string, CalificacionPrevia>> {
  const r = new Map<string, CalificacionPrevia>();
  for (let i = 0; i < huellas.length; i += 500) {
    const parte = huellas.slice(i, i + 500);
    const filas = await db.execute<{
      huella: string;
      analisis_id: string;
      conversation_id: string;
      numeracion: Record<string, string>;
    }>(sql`
      select distinct on (m.huella) m.huella, m.analisis_id::text, m.conversation_id, m.numeracion
      from comercial.analisis_calidad_muestra m
      join comercial.analisis_calidad a on a.id = m.analisis_id
      where a.location_id = ${locationId} and a.estado = 'terminado'
        and m.estado in ('calificado', 'reutilizado') and a.id <> ${excluirAnalisisId ?? -1}
        and m.huella in (${sql.join(
          parte.map((h) => sql`${h}`),
          sql`, `,
        )})
      order by m.huella, m.analisis_id desc`);
    for (const f of filas.rows)
      r.set(f.huella, {
        analisisId: Number(f.analisis_id),
        conversationId: f.conversation_id,
        numeracion: f.numeracion ?? {},
      });
  }
  return r;
}

export interface Preparacion {
  semilla: string;
  universo: Universo;
  muestra: { conversationId: string; asesorId: string }[];
  solicitudes: SolicitudPreparada[];
  sinMensajes: string[];
  descartes: Record<string, number>;
  estimacion: EstimacionCosto;
}

/**
 * Arma la muestra y las solicitudes (una por conversación) sin enviarlas. Determinista con la
 * misma semilla. El contexto de cada conversación es el tramo dentro de las 3 etapas.
 */
export async function prepararSolicitudes(
  db: Db,
  p: {
    locationId: string;
    etapas: readonly string[];
    desde: Date;
    hasta: Date;
    semilla?: string;
    analisisId?: number;
  },
  cfg: ConfiguracionCalidad,
): Promise<Preparacion> {
  const semilla = p.semilla ?? randomBytes(8).toString('hex');
  const universo = await universoCalidad(db, p.locationId, p.etapas, p.desde, p.hasta);
  const elegidas = muestraEstratificada(
    universo.porAsesor,
    cfg.tamanoMuestra,
    semilla,
    cfg.minimoPorAsesor,
  );
  const muestra = [...elegidas].flatMap(([asesorId, ids]) =>
    ids.map((conversationId) => ({ conversationId, asesorId })),
  );
  const descartes: Record<string, number> = { ...universo.descartes, triviales: 0, tope: 0 };
  const solicitudes: SolicitudPreparada[] = [];
  const sinMensajes: string[] = [];
  const etapasSql = sql.join(
    p.etapas.map((e) => sql`${e}`),
    sql`, `,
  );

  for (let i = 0; i < muestra.length; i += 300) {
    const parte = muestra.slice(i, i + 300);
    const ids = sql.join(
      parte.map((x) => sql`${x.conversationId}`),
      sql`, `,
    );
    const filas = await db.execute<{
      message_id: string;
      conversation_id: string;
      fecha: Date;
      direccion: 'inbound' | 'outbound';
      origen: string | null;
      texto: string | null;
    }>(sql`
      select distinct m.message_id, m.conversation_id, m.fecha, m.direccion, m.origen, m.texto
      from comercial.mensajes m
      join comercial.historial_etapas h
        on h.location_id = m.location_id and h.contact_id = m.contact_id and h.stage_id in (${etapasSql})
       and m.fecha >= h.desde and (h.hasta is null or m.fecha < h.hasta)
      where m.location_id = ${p.locationId} and m.conversation_id in (${ids})
        and m.fecha >= ${p.desde} and m.fecha < ${p.hasta}
        and coalesce(m.texto, '') <> ''`);
    const porConversacion = new Map<string, MensajeCalidad[]>();
    for (const f of filas.rows) {
      const lista = porConversacion.get(f.conversation_id) ?? [];
      lista.push({
        id: f.message_id,
        fecha: new Date(f.fecha),
        direccion: f.direccion,
        calificable: f.origen === 'manual',
        automatico: f.direccion === 'outbound' && f.origen !== 'manual',
        texto: f.texto ?? '',
      });
      porConversacion.set(f.conversation_id, lista);
    }
    for (const x of parte) {
      const msgs = porConversacion.get(x.conversationId) ?? [];
      const sel = seleccionarMensajes(msgs, cfg.maxMensajesConversacion);
      descartes.triviales! += sel.descartes.triviales;
      descartes.tope! += sel.descartes.tope;
      if (!sel.ids.size) {
        sinMensajes.push(x.conversationId);
        continue;
      }
      // El contexto se arma con todo lo elegido; los saludos por regla quedan como contexto sin
      // número y no se piden a la IA.
      const contexto = recortarContexto(msgs, sel.ids);
      const { porRegla, paraIa } = cfg.saludosPorRegla
        ? separarSaludos(
            [...msgs].sort((a, b) => a.fecha.getTime() - b.fecha.getTime()),
            sel.ids,
          )
        : { porRegla: new Map<string, EtiquetaCalidad>(), paraIa: sel.ids };
      const { texto, numeracion } = textoConversacion(contexto, paraIa);
      solicitudes.push({
        conversationId: x.conversationId,
        asesorId: x.asesorId,
        customId: `a${p.analisisId ?? 0}_${x.conversationId}`
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 64),
        texto,
        numeracion: Object.fromEntries(numeracion),
        mensajes: numeracion.size,
        tokensConversacion: tokensAproximados(texto),
        porRegla: [...porRegla].map(([messageId, etiqueta]) => ({ messageId, etiqueta })),
        huella: huellaSolicitud(texto, cfg.modelo, cfg.ajustes),
        reutilizarDe: null,
      });
    }
  }
  // Sin trabajo repetido (§6): lo ya calificado con la misma huella no se vuelve a enviar.
  const previas = await calificacionesPrevias(
    db,
    p.locationId,
    solicitudes.map((s) => s.huella),
    p.analisisId,
  );
  for (const s of solicitudes) if (s.mensajes) s.reutilizarDe = previas.get(s.huella) ?? null;
  const estimacion = estimarCosto(
    solicitudes
      .filter((s) => s.mensajes > 0 && s.reutilizarDe === null)
      .map((s) => ({ tokensConversacion: s.tokensConversacion, mensajes: s.mensajes })),
    undefined,
    { pensamiento: cfg.ajustes.pensamiento },
  );
  return { semilla, universo, muestra, solicitudes, sinMensajes, descartes, estimacion };
}

/**
 * Parámetros de una solicitud para la Messages / Batches API. Haiku 5.5 no admite `temperature`
 * distinta de la predeterminada: la consistencia se busca con la rúbrica, el esfuerzo y el
 * pensamiento (medidos con la calibración), y con la unificación por texto al cerrar.
 */
export function parametrosSolicitud(
  s: Pick<SolicitudPreparada, 'texto' | 'mensajes'>,
  modelo: string,
  ajustes: AjustesIa = AJUSTES_IA_POR_DEFECTO,
  formato: FormatoSalida = FORMATO_SALIDA_VIGENTE,
) {
  return {
    model: modelo,
    // Con pensamiento, sus tokens cuentan dentro de max_tokens: se deja margen.
    max_tokens: maxTokensPara(s.mensajes) + (ajustes.pensamiento ? TOKENS_MARGEN_PENSAMIENTO : 0),
    system: [
      {
        type: 'text' as const,
        text: instruccionesCalidad(formato),
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [{ role: 'user' as const, content: s.texto }],
    thinking: ajustes.pensamiento ? { type: 'adaptive' as const } : { type: 'disabled' as const },
    output_config: {
      effort: ajustes.esfuerzo,
      format: { type: 'json_schema' as const, schema: esquemaRespuestaCalidad(formato) },
    },
  };
}

/** Inicio del mes calendario (UTC) de una fecha. */
const inicioMes = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));

/** Gasto del mes en análisis (costo real si ya terminó, estimado si sigue abierto). */
export async function gastoDelMes(db: Db, ahora = new Date()): Promise<number> {
  const r = await db.execute<{ total: string | null }>(sql`
    select sum(coalesce(costo_real, costo_estimado, 0))::text as total from comercial.analisis_calidad
    where creado_en >= ${inicioMes(ahora)} and estado not in ('fallido', 'detenido_por_tope', 'sin_universo')`);
  return Number(r.rows[0]?.total ?? 0);
}

/** Análisis manuales de una subcuenta en el mes y si hay uno en curso. */
export async function limitesManuales(
  db: Db,
  locationId: string,
  ahora = new Date(),
): Promise<{ manualesMes: number; enCurso: boolean }> {
  const manuales = await db
    .select({ id: analisisCalidad.id })
    .from(analisisCalidad)
    .where(
      and(
        eq(analisisCalidad.locationId, locationId),
        eq(analisisCalidad.tipo, 'manual'),
        gte(analisisCalidad.creadoEn, inicioMes(ahora)),
        notInArray(analisisCalidad.estado, ['fallido']),
      ),
    );
  const enCurso = await db
    .select({ id: analisisCalidad.id })
    .from(analisisCalidad)
    .where(
      and(
        eq(analisisCalidad.locationId, locationId),
        inArray(analisisCalidad.estado, ['solicitado', 'preparando', 'enviado']),
      ),
    );
  return { manualesMes: manuales.length, enCurso: enCurso.length > 0 };
}

export { VERSION_RUBRICA };
