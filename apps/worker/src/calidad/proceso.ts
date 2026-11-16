/**
 * Proceso del análisis de calidad (§6.6):
 * 1. Preparar: universo, muestra, filtros y una solicitud por conversación → Batches API.
 * 2. Revisar (cada 30 min): descarga resultados, valida el JSON, guarda calificaciones; errores,
 *    vencidos o JSON inválidos se reintentan una vez en un lote nuevo; luego quedan `fallido`.
 * 3. Cerrar: promedios, mejor y peor mensaje por asesor, tokens y costo real.
 * Tope de gasto: si el análisis superaría IA_TOPE_MENSUAL_USD, se detiene sin enviar.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  CATEGORIAS_CALIDAD,
  CRITERIOS,
  VERSION_RUBRICA,
  costoReal,
  mejorYPeor,
  puntajeDeCriterios,
  unificarPorTexto,
  type Calificacion,
  type CategoriaCalidad,
  type Criterios,
} from '@driven/core';
import {
  gastoDelMes,
  parametrosSolicitud,
  prepararSolicitudes,
  tablas,
  type ConfiguracionCalidad,
  type Db,
} from '@driven/db';
import { enLotes, log } from '../sync/util';
import { dividirEnLotes, type ProveedorLotes, type SolicitudLote } from './proveedor';

export const esquemaRespuesta = z.object({
  mensajes: z.array(
    z.object({
      n: z.number().int().min(1),
      categoria: z.enum(CATEGORIAS_CALIDAD),
      criterios: z.object(
        Object.fromEntries(CRITERIOS.map((c) => [c, z.boolean()])) as Record<
          (typeof CRITERIOS)[number],
          z.ZodBoolean
        >,
      ),
      motivo: z.string(),
    }),
  ),
});

/** Crea un análisis en estado `solicitado` (lo procesa el job de solicitudes). */
export async function solicitarAnalisis(
  db: Db,
  p: {
    locationId: string;
    tipo: 'automatico' | 'manual';
    desde: string;
    hasta: string;
    lanzadoPor?: string | null;
    costoEstimado?: number | null;
  },
): Promise<number> {
  const [a] = await db
    .insert(tablas.analisisCalidad)
    .values({
      locationId: p.locationId,
      tipo: p.tipo,
      lanzadoPor: p.lanzadoPor ?? null,
      periodoDesde: p.desde,
      periodoHasta: p.hasta,
      semilla: randomBytes(8).toString('hex'),
      estado: 'solicitado',
      costoEstimado: p.costoEstimado ?? null,
      versionRubrica: VERSION_RUBRICA,
    })
    .returning({ id: tablas.analisisCalidad.id });
  return a!.id;
}

async function actualizar(
  db: Db,
  id: number,
  cambios: Partial<typeof tablas.analisisCalidad.$inferInsert>,
) {
  await db.update(tablas.analisisCalidad).set(cambios).where(eq(tablas.analisisCalidad.id, id));
}

/** Rango [desde, hasta) en UTC desde fechas "YYYY-MM-DD" (hasta inclusive). */
function rango(desde: string, hasta: string): [Date, Date] {
  return [new Date(`${desde}T00:00:00Z`), new Date(Date.parse(`${hasta}T00:00:00Z`) + 86_400_000)];
}

export async function prepararAnalisis(
  db: Db,
  proveedor: ProveedorLotes,
  analisisId: number,
  cfg: ConfiguracionCalidad,
): Promise<void> {
  const [a] = await db
    .select()
    .from(tablas.analisisCalidad)
    .where(eq(tablas.analisisCalidad.id, analisisId));
  if (!a || a.estado !== 'solicitado') return;
  await actualizar(db, analisisId, { estado: 'preparando', modelo: cfg.modelo });
  try {
    const [sub] = await db
      .select()
      .from(tablas.subcuentas)
      .where(eq(tablas.subcuentas.locationId, a.locationId));
    const etapas = sub?.etapasCalidad ?? [];
    if (etapas.length !== 3) {
      await actualizar(db, analisisId, {
        estado: 'fallido',
        error: 'La subcuenta no tiene sus 3 etapas de calidad configuradas.',
        cerradoEn: new Date(),
      });
      return;
    }
    const [desde, hasta] = rango(a.periodoDesde, a.periodoHasta);
    const prep = await prepararSolicitudes(
      db,
      { locationId: a.locationId, etapas, desde, hasta, semilla: a.semilla, analisisId },
      cfg,
    );
    const base = {
      conversacionesElegibles: prep.universo.conversaciones,
      conversacionesMuestra: prep.muestra.length,
      descartes: { ...prep.descartes, sinMensajesCalificables: prep.sinMensajes.length },
      mensajesEstimados: prep.solicitudes.reduce((s, x) => s + x.mensajes, 0),
      costoEstimado: prep.estimacion.costoUsd,
    };
    if (!prep.solicitudes.length) {
      await actualizar(db, analisisId, {
        ...base,
        estado: 'sin_universo',
        cerradoEn: new Date(),
        error: 'No hay mensajes de asesores para calificar en el periodo y las etapas elegidas.',
      });
      return;
    }
    // Tope de gasto mensual (§6.4): se estima antes de enviar.
    const gasto = (await gastoDelMes(db)) - (a.costoEstimado ?? 0);
    if (gasto + prep.estimacion.costoUsd > cfg.topeMensualUsd) {
      await actualizar(db, analisisId, {
        ...base,
        estado: 'detenido_por_tope',
        cerradoEn: new Date(),
        error: `El análisis costaría US$ ${prep.estimacion.costoUsd.toFixed(2)} y el gasto del mes es US$ ${gasto.toFixed(2)} (tope US$ ${cfg.topeMensualUsd}).`,
      });
      log('calidad_tope', { analisisId, estimado: prep.estimacion.costoUsd, gasto });
      return;
    }

    const filasMuestra = [
      ...prep.solicitudes.map((s) => ({
        analisisId,
        conversationId: s.conversationId,
        asesorId: s.asesorId,
        estado: 'pendiente',
        mensajes: s.mensajes,
        numeracion: s.numeracion,
      })),
      ...prep.sinMensajes.map((c) => ({
        analisisId,
        conversationId: c,
        asesorId: prep.muestra.find((m) => m.conversationId === c)?.asesorId ?? null,
        estado: 'sin_mensajes',
      })),
    ];
    for (const parte of enLotes(filasMuestra, 500)) {
      await db.insert(tablas.analisisCalidadMuestra).values(parte).onConflictDoNothing();
    }
    const solicitudes: SolicitudLote[] = prep.solicitudes.map((s) => ({
      custom_id: s.customId,
      params: parametrosSolicitud(s, cfg.modelo, cfg.ajustes),
    }));
    const batchIds = await enviar(
      db,
      proveedor,
      analisisId,
      solicitudes,
      prep.solicitudes.map((s) => s.conversationId),
    );
    await actualizar(db, analisisId, { ...base, estado: 'enviado', batchIds });
    log('calidad_enviado', {
      analisisId,
      solicitudes: solicitudes.length,
      lotes: batchIds.length,
      estimado: prep.estimacion.costoUsd,
    });
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await actualizar(db, analisisId, {
      estado: 'fallido',
      error: mensaje.slice(0, 500),
      cerradoEn: new Date(),
    });
    log('calidad_error', { analisisId, error: mensaje });
  }
}

async function enviar(
  db: Db,
  proveedor: ProveedorLotes,
  analisisId: number,
  solicitudes: SolicitudLote[],
  conversaciones: string[],
): Promise<string[]> {
  const ids: string[] = [];
  let i = 0;
  for (const lote of dividirEnLotes(solicitudes)) {
    const id = await proveedor.crearLote(lote);
    ids.push(id);
    const convs = conversaciones.slice(i, i + lote.length);
    i += lote.length;
    for (const parte of enLotes(convs, 500)) {
      await db
        .update(tablas.analisisCalidadMuestra)
        .set({
          estado: 'enviado',
          batchId: id,
          intentos: sql`${tablas.analisisCalidadMuestra.intentos} + 1`,
        })
        .where(
          and(
            eq(tablas.analisisCalidadMuestra.analisisId, analisisId),
            inArray(tablas.analisisCalidadMuestra.conversationId, parte),
          ),
        );
    }
  }
  return ids;
}

/** Revisa los lotes de un análisis enviado; si todos terminaron, guarda resultados y reintenta o cierra. */
export async function revisarAnalisis(
  db: Db,
  proveedor: ProveedorLotes,
  analisisId: number,
  cfg: ConfiguracionCalidad,
): Promise<'esperando' | 'reintentando' | 'terminado'> {
  const [a] = await db
    .select()
    .from(tablas.analisisCalidad)
    .where(eq(tablas.analisisCalidad.id, analisisId));
  if (!a || a.estado !== 'enviado') return 'terminado';
  const muestra = await db
    .select()
    .from(tablas.analisisCalidadMuestra)
    .where(eq(tablas.analisisCalidadMuestra.analisisId, analisisId));
  const pendientes = muestra.filter((m) => m.estado === 'enviado');
  const lotesAbiertos = [
    ...new Set(pendientes.map((m) => m.batchId).filter((x): x is string => !!x)),
  ];
  for (const id of lotesAbiertos) {
    if ((await proveedor.estadoLote(id)) !== 'ended') return 'esperando';
  }

  const porCustomId = new Map(
    pendientes.map((m) => [
      `a${analisisId}_${m.conversationId}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64),
      m,
    ]),
  );
  let tokensEntrada = a.tokensEntrada ?? 0;
  let tokensSalida = a.tokensSalida ?? 0;
  let costo = a.costoReal ?? 0;
  const aReintentar: typeof pendientes = [];
  const fallar = async (m: (typeof pendientes)[number], error: string) => {
    if (m.intentos < 2) aReintentar.push(m);
    else
      await db
        .update(tablas.analisisCalidadMuestra)
        .set({ estado: 'fallido', error: error.slice(0, 300) })
        .where(
          and(
            eq(tablas.analisisCalidadMuestra.analisisId, analisisId),
            eq(tablas.analisisCalidadMuestra.conversationId, m.conversationId),
          ),
        );
  };

  // Textos y largos de los mensajes calificados (para mejor/peor y desempates).
  for (const id of lotesAbiertos) {
    for await (const r of proveedor.resultados(id)) {
      const m = porCustomId.get(r.custom_id);
      if (!m) continue;
      porCustomId.delete(r.custom_id);
      if (r.uso) {
        tokensEntrada +=
          r.uso.input_tokens +
          (r.uso.cache_read_input_tokens ?? 0) +
          (r.uso.cache_creation_input_tokens ?? 0);
        tokensSalida += r.uso.output_tokens;
        costo += costoReal(r.uso);
      }
      if (r.tipo !== 'succeeded' || !r.texto) {
        await fallar(m, r.error ?? r.tipo);
        continue;
      }
      if (r.stopReason === 'refusal' || r.stopReason === 'max_tokens') {
        await fallar(m, `stop_reason ${r.stopReason}`);
        continue;
      }
      let datos: z.infer<typeof esquemaRespuesta>;
      try {
        datos = esquemaRespuesta.parse(JSON.parse(r.texto));
      } catch {
        await fallar(m, 'JSON inválido');
        continue;
      }
      const numeracion = (m.numeracion ?? {}) as Record<string, string>;
      const filas = datos.mensajes
        .filter((x) => numeracion[String(x.n)])
        .map((x) => ({
          analisisId,
          messageId: numeracion[String(x.n)]!,
          conversationId: m.conversationId,
          asesorId: m.asesorId,
          categoria: x.categoria,
          puntaje: x.categoria === 'multimedia' ? null : puntajeDeCriterios(x.criterios),
          criterios: x.criterios,
          motivo: x.motivo.slice(0, 120),
          modelo: a.modelo ?? cfg.modelo,
          versionRubrica: a.versionRubrica ?? VERSION_RUBRICA,
        }));
      if (filas.length) await db.insert(tablas.clasificaciones).values(filas).onConflictDoNothing();
      await db
        .update(tablas.analisisCalidadMuestra)
        .set({ estado: 'calificado' })
        .where(
          and(
            eq(tablas.analisisCalidadMuestra.analisisId, analisisId),
            eq(tablas.analisisCalidadMuestra.conversationId, m.conversationId),
          ),
        );
    }
  }
  // Las que no aparecieron en los resultados también se reintentan.
  for (const m of porCustomId.values()) await fallar(m, 'sin resultado');
  await actualizar(db, analisisId, {
    tokensEntrada,
    tokensSalida,
    costoReal: Math.round(costo * 10_000) / 10_000,
  });

  if (aReintentar.length) {
    const etapas =
      (
        await db
          .select()
          .from(tablas.subcuentas)
          .where(eq(tablas.subcuentas.locationId, a.locationId))
      )[0]?.etapasCalidad ?? [];
    const [desde, hasta] = rango(a.periodoDesde, a.periodoHasta);
    // Se rearman las mismas solicitudes (misma semilla) y se reenvían solo las fallidas.
    const prep = await prepararSolicitudes(
      db,
      { locationId: a.locationId, etapas, desde, hasta, semilla: a.semilla, analisisId },
      cfg,
    );
    const ids = new Set(aReintentar.map((m) => m.conversationId));
    const nuevas = prep.solicitudes.filter((s) => ids.has(s.conversationId));
    const batchIds = await enviar(
      db,
      proveedor,
      analisisId,
      nuevas.map((s) => ({
        custom_id: s.customId,
        params: parametrosSolicitud(s, a.modelo ?? cfg.modelo, cfg.ajustes),
      })),
      nuevas.map((s) => s.conversationId),
    );
    await actualizar(db, analisisId, { batchIds: [...(a.batchIds ?? []), ...batchIds] });
    log('calidad_reintento', { analisisId, solicitudes: nuevas.length });
    return 'reintentando';
  }
  await cerrarAnalisis(db, analisisId);
  return 'terminado';
}

/**
 * Misma frase, mismo resultado (§6.2): unifica tono, extensión y personalización entre mensajes con
 * el mismo texto dentro del análisis y recalcula su puntaje. Devuelve cuántos mensajes cambiaron.
 */
export async function unificarAnalisis(db: Db, analisisId: number): Promise<number> {
  const filas = await db.execute<{
    message_id: string;
    conversation_id: string;
    categoria: string;
    criterios: Criterios;
    texto: string | null;
  }>(sql`
    select c.message_id, c.conversation_id, c.categoria, c.criterios, m.texto
    from comercial.clasificaciones c
    join comercial.mensajes m on m.message_id = c.message_id
    where c.analisis_id = ${analisisId}`);
  const { cambios, grupos } = unificarPorTexto(
    filas.rows.map((f) => ({
      messageId: f.message_id,
      conversationId: f.conversation_id,
      texto: f.texto ?? '',
      categoria: f.categoria as CategoriaCalidad,
      criterios: f.criterios,
    })),
  );
  for (const [messageId, criterios] of cambios) {
    await db
      .update(tablas.clasificaciones)
      .set({ criterios, puntaje: puntajeDeCriterios(criterios) })
      .where(
        and(
          eq(tablas.clasificaciones.analisisId, analisisId),
          eq(tablas.clasificaciones.messageId, messageId),
        ),
      );
  }
  if (cambios.size) log('calidad_unificado', { analisisId, grupos, mensajes: cambios.size });
  return cambios.size;
}

/** Cierra el análisis: unificación por texto, mejor y peor mensaje por asesor y totales. */
export async function cerrarAnalisis(db: Db, analisisId: number): Promise<void> {
  await unificarAnalisis(db, analisisId);
  const cal = await db.execute<{
    message_id: string;
    asesor_id: string | null;
    categoria: string;
    puntaje: number | null;
    largo: number;
  }>(sql`
    select c.message_id, c.asesor_id, c.categoria, c.puntaje, coalesce(length(m.texto), 0) as largo
    from comercial.clasificaciones c
    left join comercial.mensajes m on m.message_id = c.message_id
    where c.analisis_id = ${analisisId}`);
  const [a] = await db
    .select()
    .from(tablas.analisisCalidad)
    .where(eq(tablas.analisisCalidad.id, analisisId));
  const calificaciones: Calificacion[] = cal.rows
    .filter((c) => c.puntaje !== null)
    .map((c) => ({
      messageId: c.message_id,
      asesorId: c.asesor_id,
      categoria: c.categoria as Calificacion['categoria'],
      puntaje: c.puntaje!,
      largo: Number(c.largo),
    }));
  const ejemplos = mejorYPeor(calificaciones);
  await db.delete(tablas.ejemplosCalidad).where(eq(tablas.ejemplosCalidad.analisisId, analisisId));
  if (ejemplos.size) {
    await db.insert(tablas.ejemplosCalidad).values(
      [...ejemplos].map(([asesorId, e]) => ({
        analisisId,
        asesorId,
        locationId: a!.locationId,
        mejorMessageId: e.mejor,
        peorMessageId: e.peor,
      })),
    );
  }
  const fallidos = (
    await db
      .select()
      .from(tablas.analisisCalidadMuestra)
      .where(
        and(
          eq(tablas.analisisCalidadMuestra.analisisId, analisisId),
          eq(tablas.analisisCalidadMuestra.estado, 'fallido'),
        ),
      )
  ).length;
  await actualizar(db, analisisId, {
    estado: 'terminado',
    mensajesCalificados: cal.rows.length,
    fallidos,
    cerradoEn: new Date(),
  });
  log('calidad_terminado', {
    analisisId,
    calificados: cal.rows.length,
    fallidos,
    costoReal: a?.costoReal,
  });
}

/** Procesa solicitudes pendientes y revisa análisis enviados (lo llaman los jobs). */
export async function procesarPendientes(
  db: Db,
  proveedor: ProveedorLotes,
  cfg: ConfiguracionCalidad,
  que: 'solicitudes' | 'revisar',
): Promise<void> {
  const estado = que === 'solicitudes' ? 'solicitado' : 'enviado';
  const filas = await db
    .select({ id: tablas.analisisCalidad.id })
    .from(tablas.analisisCalidad)
    .where(eq(tablas.analisisCalidad.estado, estado));
  for (const f of filas) {
    if (que === 'solicitudes') await prepararAnalisis(db, proveedor, f.id, cfg);
    else await revisarAnalisis(db, proveedor, f.id, cfg);
  }
}
