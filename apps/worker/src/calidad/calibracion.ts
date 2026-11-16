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
  MARGEN_BLOQUE_MS,
  VERSION_RUBRICA,
  compararCalibracion,
  costoReal,
  preciosDe,
  bloquesDeRespuesta,
  esTrivial,
  unificarRespuestaPorBloque,
  recortarContexto,
  separarSaludos,
  textoConversacion,
  type EtiquetaCalidad,
  type FormatoSalida,
  type MarcaBloque,
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

/** Lo que se envía por cada mensaje del conjunto: su bloque, numerado, y lo calificado por regla. */
export interface PlanCalibracion {
  objetivo: string;
  numeracion: Record<number, string>;
  regla: Map<string, EtiquetaCalidad>;
  bloques: Map<string, MarcaBloque>;
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
  /** Bloque de respuesta de cada mensaje del conjunto (v3). */
  marcas: Map<string, MarcaBloque>;
  /** Por solicitud: los mensajes del bloque enviados a la IA y los calificados por regla. */
  planes: Map<string, PlanCalibracion>;
}> {
  const solicitudes: SolicitudLote[] = [];
  const porCustomId = new Map<string, string>();
  const faltantes: string[] = [];
  const porRegla = new Map<string, EtiquetaCalidad>();
  const marcas = new Map<string, MarcaBloque>();
  const planes = new Map<string, PlanCalibracion>();
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
        and m.fecha <= o.fecha + make_interval(secs => ${MARGEN_BLOQUE_MS / 1000})
        and m.fecha > o.fecha - make_interval(days => ${DIAS_CONTEXTO})
        and coalesce(m.texto, '') <> ''`);
    const msgs: MensajeCalidad[] = filas.rows.map((f) => ({
      id: f.message_id,
      fecha: new Date(f.fecha),
      direccion: f.direccion,
      calificable: f.message_id === item.messageId,
      automatico: f.direccion === 'outbound' && f.origen !== 'manual',
      texto: f.texto ?? '',
    }));
    if (!msgs.some((m) => m.id === item.messageId)) {
      faltantes.push(item.messageId);
      continue;
    }
    const todos = [...msgs].sort((a, b) => a.fecha.getTime() - b.fecha.getTime());
    const bloques = bloquesDeRespuesta(todos);
    // Contexto: lo anterior al mensaje y, después de él, solo el resto de su bloque (v3: la
    // respuesta se evalúa como bloque).
    const fechaObjetivo = todos.find((m) => m.id === item.messageId)!.fecha.getTime();
    const bloqueObjetivo = bloques.get(item.messageId);
    const orden = todos.filter(
      (m) =>
        m.fecha.getTime() <= fechaObjetivo ||
        (bloqueObjetivo !== 'S' && bloques.get(m.id) === bloqueObjetivo),
    );
    const bloqueObj = bloques.get(item.messageId) ?? 'S';
    marcas.set(item.messageId, bloqueObj);
    // Como en el análisis (v3): se califica el bloque completo del mensaje (sus otros mensajes del
    // asesor no triviales), "responde" se unifica por bloque y se toma el resultado del mensaje.
    const delBloque = new Set(
      bloqueObj === 'S'
        ? [item.messageId]
        : orden
            .filter(
              (m) =>
                m.direccion === 'outbound' &&
                !m.automatico &&
                bloques.get(m.id) === bloqueObj &&
                (m.id === item.messageId || !esTrivial(m.texto)),
            )
            .map((m) => m.id),
    );
    const { porRegla: regla, paraIa } = saludosPorRegla
      ? separarSaludos(orden, delBloque, bloques)
      : { porRegla: new Map<string, EtiquetaCalidad>(), paraIa: delBloque };
    if (!paraIa.size) {
      // Todo el bloque son saludos sueltos: se resuelve por regla, sin IA.
      const final = new Map(regla);
      for (const [id, criterios] of unificarRespuestaPorBloque(
        [...regla].map(([messageId, e]) => ({ messageId, criterios: e.criterios })),
        bloques,
      ))
        final.set(id, { ...final.get(id)!, criterios });
      porRegla.set(item.messageId, final.get(item.messageId)!);
      continue;
    }
    const posteriores = orden.filter((m) => m.fecha.getTime() > fechaObjetivo);
    const contexto = [
      ...recortarContexto(
        orden.filter((m) => m.fecha.getTime() <= fechaObjetivo),
        new Set([item.messageId]),
      ),
      ...posteriores,
    ];
    const { texto, numeracion } = textoConversacion(contexto, paraIa, bloques);
    const customId = `cal_${i}`;
    porCustomId.set(customId, item.messageId);
    planes.set(customId, {
      objetivo: item.messageId,
      numeracion: Object.fromEntries(numeracion),
      regla,
      bloques,
    });
    solicitudes.push({
      custom_id: customId,
      params: parametrosSolicitud({ texto, mensajes: numeracion.size }, modelo, ajustes, formato),
    });
  }
  return { solicitudes, porCustomId, faltantes, porRegla, marcas, planes };
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
  const { solicitudes, porCustomId, faltantes, porRegla, marcas, planes } =
    await solicitudesCalibracion(
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
        costo += costoReal(r.uso, preciosDe(o.modelo));
        tokensEntrada +=
          r.uso.input_tokens +
          (r.uso.cache_read_input_tokens ?? 0) +
          (r.uso.cache_creation_input_tokens ?? 0);
        tokensSalida += r.uso.output_tokens;
      }
      const id = porCustomId.get(r.custom_id);
      const plan = planes.get(r.custom_id);
      if (!id || !plan || r.tipo !== 'succeeded' || !r.texto || r.stopReason === 'refusal')
        continue;
      const datos = esquemaRespuesta.safeParse(safeJson(r.texto));
      if (!datos.success) continue;
      // Etiquetas del bloque (IA + regla), con "responde" unificado como al cerrar un análisis.
      const bloque = new Map<string, EtiquetaCalidad>(plan.regla);
      for (const x of datos.data.mensajes) {
        const mid = plan.numeracion[x.n];
        if (mid) bloque.set(mid, { categoria: x.categoria, criterios: x.criterios });
      }
      for (const [mid, criterios] of unificarRespuestaPorBloque(
        [...bloque].map(([messageId, e]) => ({ messageId, criterios: e.criterios })),
        plan.bloques,
      ))
        bloque.set(mid, { ...bloque.get(mid)!, criterios });
      const x = bloque.get(id);
      if (!x) continue;
      // Como en el análisis (v3): un mensaje de seguimiento queda con esa categoría.
      const seguimiento =
        marcas.get(id) === 'S' && x.categoria !== 'seguimiento' && x.categoria !== 'multimedia';
      obtenidos.set(id, seguimiento ? { ...x, categoria: 'seguimiento' } : x);
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
