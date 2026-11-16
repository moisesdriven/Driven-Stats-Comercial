/**
 * Calibración de la rúbrica (§6.2): califica con la IA un conjunto de mensajes ya revisados por una
 * persona y mide la coincidencia. Se corre al cambiar la rúbrica, el modelo o las instrucciones; una
 * versión nueva pasa a producción solo si supera el mínimo acordado.
 *
 * El conjunto guarda solo ids de mensajes y etiquetas de referencia (sin textos de clientes): el
 * contexto se reconstruye desde la base, igual que en un análisis real.
 */
import { readFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CATEGORIAS_CALIDAD,
  CRITERIOS,
  FORMATO_SALIDA_VIGENTE,
  VERSION_RUBRICA,
  compararCalibracion,
  costoReal,
  recortarContexto,
  separarSaludos,
  textoConversacion,
  type EtiquetaCalidad,
  type FormatoSalida,
  type MensajeCalidad,
  type ResultadoCalibracion,
} from '@driven/core';
import { AJUSTES_IA_POR_DEFECTO, parametrosSolicitud, type AjustesIa, type Db } from '@driven/db';
import { esquemaRespuesta } from './proceso';
import type { ProveedorLotes, SolicitudLote } from './proveedor';

const etiqueta = z.object({
  categoria: z.enum(CATEGORIAS_CALIDAD),
  criterios: z.object(
    Object.fromEntries(CRITERIOS.map((c) => [c, z.boolean()])) as Record<
      (typeof CRITERIOS)[number],
      z.ZodBoolean
    >,
  ),
});

export const esquemaConjunto = z.object({
  descripcion: z.string(),
  locationId: z.string().min(1),
  mensajes: z.array(etiqueta.extend({ messageId: z.string().min(1) })).min(1),
});
export type ConjuntoCalibracion = z.infer<typeof esquemaConjunto>;

export async function leerConjunto(ruta: string): Promise<ConjuntoCalibracion> {
  return esquemaConjunto.parse(JSON.parse(await readFile(ruta, 'utf8')));
}

/** Días de conversación previos al mensaje que se usan como contexto. */
const DIAS_CONTEXTO = 7;

/** Arma una solicitud por mensaje del conjunto, con su conversación previa como contexto. */
export async function solicitudesCalibracion(
  db: Db,
  conjunto: ConjuntoCalibracion,
  modelo: string,
  ajustes: AjustesIa = AJUSTES_IA_POR_DEFECTO,
  saludosPorRegla = true,
  formato: FormatoSalida = FORMATO_SALIDA_VIGENTE,
): Promise<{
  solicitudes: SolicitudLote[];
  porCustomId: Map<string, string>;
  faltantes: string[];
  /** Mensajes calificados por la regla de saludos (no van a la IA). */
  porRegla: Map<string, EtiquetaCalidad>;
}> {
  const solicitudes: SolicitudLote[] = [];
  const porCustomId = new Map<string, string>();
  const faltantes: string[] = [];
  const porRegla = new Map<string, EtiquetaCalidad>();
  for (const [i, item] of conjunto.mensajes.entries()) {
    const filas = await db.execute<{
      message_id: string;
      fecha: Date;
      direccion: 'inbound' | 'outbound';
      origen: string | null;
      texto: string | null;
    }>(sql`
      with objetivo as (
        select conversation_id, fecha from comercial.mensajes
        where message_id = ${item.messageId} and location_id = ${conjunto.locationId}
        limit 1
      )
      select m.message_id, m.fecha, m.direccion, m.origen, m.texto
      from comercial.mensajes m, objetivo o
      where m.location_id = ${conjunto.locationId} and m.conversation_id = o.conversation_id
        and m.fecha <= o.fecha and m.fecha > o.fecha - make_interval(days => ${DIAS_CONTEXTO})
        and coalesce(m.texto, '') <> ''`);
    const msgs: MensajeCalidad[] = filas.rows.map((f) => ({
      id: f.message_id,
      fecha: new Date(f.fecha),
      direccion: f.direccion,
      calificable: f.message_id === item.messageId,
      automatico: f.direccion === 'outbound' && f.origen !== 'manual',
      texto: f.texto ?? '',
    }));
    const objetivo = new Set([item.messageId]);
    if (!msgs.some((m) => m.id === item.messageId)) {
      faltantes.push(item.messageId);
      continue;
    }
    if (saludosPorRegla) {
      const orden = [...msgs].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
      const regla = separarSaludos(orden, objetivo).porRegla.get(item.messageId);
      if (regla) {
        porRegla.set(item.messageId, regla);
        continue;
      }
    }
    const { texto, numeracion } = textoConversacion(recortarContexto(msgs, objetivo), objetivo);
    const customId = `cal_${i}`;
    porCustomId.set(customId, item.messageId);
    solicitudes.push({
      custom_id: customId,
      params: parametrosSolicitud({ texto, mensajes: numeracion.size }, modelo, ajustes, formato),
    });
  }
  return { solicitudes, porCustomId, faltantes, porRegla };
}

export interface InformeCalibracion extends ResultadoCalibracion {
  versionRubrica: string;
  /** Mensajes del conjunto calificados por la regla de saludos. */
  porRegla: number;
  formato: FormatoSalida;
  /** Solicitudes enviadas a la IA y su uso de tokens. */
  solicitudes: number;
  tokensEntrada: number;
  tokensSalida: number;
  modelo: string;
  ajustes: AjustesIa;
  faltantes: string[];
  costoUsd: number;
}

/** Envía el conjunto a la Batches API, espera los resultados y los compara con la referencia. */
export async function calibrar(
  db: Db,
  proveedor: ProveedorLotes,
  conjunto: ConjuntoCalibracion,
  o: {
    modelo: string;
    ajustes?: AjustesIa;
    esperaMs?: number;
    maxEsperas?: number;
    /** Calificar los saludos sueltos por regla, como en un análisis real (por defecto sí). */
    saludosPorRegla?: boolean;
    /** Formato de la respuesta (por defecto el vigente). */
    formato?: FormatoSalida;
  },
): Promise<InformeCalibracion> {
  const { solicitudes, porCustomId, faltantes, porRegla } = await solicitudesCalibracion(
    db,
    conjunto,
    o.modelo,
    o.ajustes,
    o.saludosPorRegla ?? true,
    o.formato ?? FORMATO_SALIDA_VIGENTE,
  );
  const obtenidos = new Map<string, EtiquetaCalidad>(porRegla);
  let costo = 0;
  let tokensEntrada = 0;
  let tokensSalida = 0;
  if (solicitudes.length) {
    const lote = await proveedor.crearLote(solicitudes);
    for (let n = 0; (await proveedor.estadoLote(lote)) !== 'ended'; n++) {
      if (n >= (o.maxEsperas ?? 240)) throw new Error(`El lote ${lote} no terminó a tiempo.`);
      await new Promise((r) => setTimeout(r, o.esperaMs ?? 15_000));
    }
    for await (const r of proveedor.resultados(lote)) {
      if (r.uso) {
        costo += costoReal(r.uso);
        tokensEntrada +=
          r.uso.input_tokens +
          (r.uso.cache_read_input_tokens ?? 0) +
          (r.uso.cache_creation_input_tokens ?? 0);
        tokensSalida += r.uso.output_tokens;
      }
      const id = porCustomId.get(r.custom_id);
      if (!id || r.tipo !== 'succeeded' || !r.texto || r.stopReason === 'refusal') continue;
      const datos = esquemaRespuesta.safeParse(safeJson(r.texto));
      const x = datos.success ? datos.data.mensajes.find((m) => m.n === 1) : undefined;
      if (x) obtenidos.set(id, { categoria: x.categoria, criterios: x.criterios });
    }
  }
  const esperados = new Map(
    conjunto.mensajes
      .filter((m) => !faltantes.includes(m.messageId))
      .map((m) => [m.messageId, { categoria: m.categoria, criterios: m.criterios }]),
  );
  return {
    versionRubrica: VERSION_RUBRICA,
    modelo: o.modelo,
    ajustes: o.ajustes ?? AJUSTES_IA_POR_DEFECTO,
    faltantes,
    porRegla: porRegla.size,
    formato: o.formato ?? FORMATO_SALIDA_VIGENTE,
    solicitudes: solicitudes.length,
    tokensEntrada,
    tokensSalida,
    costoUsd: Math.round(costo * 10_000) / 10_000,
    ...compararCalibracion(esperados, obtenidos),
  };
}

function safeJson(t: string): unknown {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
}
