/** Análisis de calidad desde la web (§6.5–6.7): estimación, lanzamiento, historial y resultados. */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { VERSION_RUBRICA } from '@driven/core';
import {
  configuracionCalidad,
  gastoDelMes,
  limitesManuales,
  prepararSolicitudes,
  tablas,
  type Db,
} from '@driven/db';
import {
  exigirAdmin,
  exigirAsesorPropio,
  exigirModulo,
  exigirSubcuenta,
  type ContextoAcceso,
} from './acceso';
import { auditar } from './auditoria';
import { enlaceGhl } from './consultas/listas';
import { ErrorHttp, solicitudInvalida } from './errores';

export const esquemaPeriodo = z.object({
  subcuentas: z.array(z.string().min(1)).min(1).max(50),
  desde: z.iso.date(),
  hasta: z.iso.date(),
});

const rango = (desde: string, hasta: string): [Date, Date] => [
  new Date(`${desde}T00:00:00Z`),
  new Date(Date.parse(`${hasta}T00:00:00Z`) + 86_400_000),
];

/** Lo que se muestra antes de lanzar: elegibles, muestra, mensajes, costo estimado y gasto del mes. */
export async function estimarAnalisis(
  db: Db,
  ctx: ContextoAcceso,
  e: z.infer<typeof esquemaPeriodo>,
) {
  exigirAdmin(ctx);
  if (e.desde > e.hasta) throw solicitudInvalida('Rango de fechas inválido.');
  const cfg = configuracionCalidad();
  const [desde, hasta] = rango(e.desde, e.hasta);
  const subs = await db
    .select()
    .from(tablas.subcuentas)
    .where(inArray(tablas.subcuentas.locationId, e.subcuentas));
  const resultado = [];
  for (const s of subs) {
    const etapas = s.etapasCalidad ?? [];
    const limites = await limitesManuales(db, s.locationId);
    if (etapas.length !== 3) {
      resultado.push({
        locationId: s.locationId,
        nombre: s.nombre,
        error: 'Faltan sus 3 etapas de calidad.',
        ...limites,
      });
      continue;
    }
    const p = await prepararSolicitudes(
      db,
      { locationId: s.locationId, etapas, desde, hasta },
      cfg,
    );
    resultado.push({
      locationId: s.locationId,
      nombre: s.nombre,
      conversacionesElegibles: p.universo.conversaciones,
      muestra: p.muestra.length,
      // Todo lo que se califica: con IA y saludos por regla.
      mensajesEstimados: p.solicitudes.reduce((t, x) => t + x.mensajes + x.porRegla.length, 0),
      mensajesPorRegla: p.solicitudes.reduce((t, x) => t + x.porRegla.length, 0),
      // Ya calificadas con la misma rúbrica y sin mensajes nuevos: no se pagan otra vez.
      conversacionesReutilizadas: p.solicitudes.filter((x) => x.reutilizarDe !== null).length,
      costoEstimadoUsd: p.estimacion.costoUsd,
      costoMaximoUsd: p.estimacion.costoMaximoUsd,
      descartes: { ...p.descartes, sinMensajesCalificables: p.sinMensajes.length },
      ...limites,
    });
  }
  const gasto = await gastoDelMes(db);
  const total = resultado.reduce(
    (t, r) => t + ('costoEstimadoUsd' in r ? (r.costoEstimadoUsd ?? 0) : 0),
    0,
  );
  // Peor caso (sin caché y, con pensamiento, todo su margen): es el que se compara con el tope.
  const maximo = resultado.reduce(
    (t, r) => t + ('costoMaximoUsd' in r ? (r.costoMaximoUsd ?? 0) : 0),
    0,
  );
  return {
    subcuentas: resultado,
    costoEstimadoTotalUsd: Math.round(total * 10_000) / 10_000,
    costoMaximoTotalUsd: Math.ceil(maximo * 10_000) / 10_000,
    gastoDelMesUsd: gasto,
    topeMensualUsd: cfg.topeMensualUsd,
    maxManualesMes: cfg.maxManualesMes,
    modelo: cfg.modelo,
  };
}

/**
 * Lanza análisis manuales (la revalidación con contraseña o 2FA la hace la ruta antes). Rechaza
 * subcuentas sin etapas, con un análisis en curso o con el máximo de manuales del mes, y el
 * conjunto si superaría el tope de gasto. Queda en auditoría con el costo estimado.
 */
export async function lanzarAnalisis(
  db: Db,
  ctx: ContextoAcceso,
  e: z.infer<typeof esquemaPeriodo>,
) {
  const est = await estimarAnalisis(db, ctx, e);
  for (const s of est.subcuentas) {
    if ('error' in s && s.error) throw solicitudInvalida(`${s.nombre}: ${s.error}`);
    if (s.enCurso)
      throw new ErrorHttp(409, `${s.nombre} ya tiene un análisis en curso.`, 'analisis_en_curso');
    if (s.manualesMes >= est.maxManualesMes)
      throw new ErrorHttp(
        409,
        `${s.nombre} ya usó sus ${est.maxManualesMes} análisis manuales del mes.`,
        'limite_manuales',
      );
  }
  if (est.gastoDelMesUsd + est.costoMaximoTotalUsd > est.topeMensualUsd) {
    throw new ErrorHttp(
      409,
      `El análisis costaría unos US$ ${est.costoEstimadoTotalUsd.toFixed(2)} (hasta US$ ${est.costoMaximoTotalUsd.toFixed(2)} si la caché no funciona) y podría superar el tope mensual (US$ ${est.topeMensualUsd}; gastado: US$ ${est.gastoDelMesUsd.toFixed(2)}).`,
      'tope_gasto',
    );
  }
  const ids: number[] = [];
  for (const s of est.subcuentas) {
    const [a] = await db
      .insert(tablas.analisisCalidad)
      .values({
        locationId: s.locationId,
        tipo: 'manual',
        lanzadoPor: ctx.usuarioId,
        periodoDesde: e.desde,
        periodoHasta: e.hasta,
        semilla: randomBytes(8).toString('hex'),
        estado: 'solicitado',
        costoEstimado: 'costoEstimadoUsd' in s ? (s.costoEstimadoUsd ?? null) : null,
        versionRubrica: VERSION_RUBRICA,
      })
      .returning({ id: tablas.analisisCalidad.id });
    ids.push(a!.id);
  }
  await auditar(db, ctx.usuarioId, 'calidad_lanzado', {
    subcuentas: e.subcuentas,
    desde: e.desde,
    hasta: e.hasta,
    costoEstimadoUsd: est.costoEstimadoTotalUsd,
    costoMaximoUsd: est.costoMaximoTotalUsd,
    analisis: ids,
  });
  return { analisis: ids, costoEstimadoUsd: est.costoEstimadoTotalUsd };
}

/** Historial de análisis y gasto del mes frente al tope (Configuración › Calidad). */
export async function historialCalidad(db: Db, ctx: ContextoAcceso) {
  exigirModulo(ctx, 'configuracion', 'ver');
  const cfg = configuracionCalidad();
  const filas = await db
    .select()
    .from(tablas.analisisCalidad)
    .where(
      inArray(tablas.analisisCalidad.locationId, ctx.subcuentas.length ? ctx.subcuentas : ['-']),
    )
    .orderBy(desc(tablas.analisisCalidad.creadoEn))
    .limit(100);
  return {
    analisis: filas.map(({ semilla: _s, batchIds: _b, ...a }) => a),
    gastoDelMesUsd: await gastoDelMes(db),
    topeMensualUsd: cfg.topeMensualUsd,
  };
}

export interface ResumenCalidad {
  analisisId: number;
  periodoDesde: string;
  periodoHasta: string;
  muestra: number | null;
  promedio: number | null;
  /** Mensajes con puntaje (para ponderar entre subcuentas). */
  mensajesCalificados: number;
  porAsesor: Record<string, { promedio: number; mensajes: number }>;
  distribucion: Record<string, number>;
  distribucionPorAsesor: Record<string, Record<string, number>>;
}

/** Último análisis terminado de cada subcuenta: promedio, por asesor y distribución por tipo (§6.7). */
export async function ultimosAnalisis(
  db: Db,
  locationIds: string[],
): Promise<Map<string, ResumenCalidad>> {
  const r = new Map<string, ResumenCalidad>();
  if (!locationIds.length) return r;
  const ultimos = await db.execute<{
    id: number;
    location_id: string;
    periodo_desde: string;
    periodo_hasta: string;
    conversaciones_muestra: number | null;
  }>(sql`
    select distinct on (location_id) id, location_id, periodo_desde::text, periodo_hasta::text, conversaciones_muestra
    from comercial.analisis_calidad
    where estado = 'terminado' and location_id in (${sql.join(
      locationIds.map((x) => sql`${x}`),
      sql`, `,
    )})
    order by location_id, cerrado_en desc nulls last`);
  for (const u of ultimos.rows) {
    const cal = await db.execute<{
      asesor_id: string | null;
      categoria: string;
      n: number;
      suma: number;
      con_puntaje: number;
    }>(sql`
      select asesor_id, categoria, count(*)::int as n, coalesce(sum(puntaje), 0)::int as suma, count(puntaje)::int as con_puntaje
      from comercial.clasificaciones where analisis_id = ${u.id} group by 1, 2`);
    let suma = 0;
    let n = 0;
    const porAsesor: Record<string, { suma: number; n: number }> = {};
    const distribucion: Record<string, number> = {};
    const distribucionPorAsesor: Record<string, Record<string, number>> = {};
    for (const c of cal.rows) {
      if (c.asesor_id) {
        const d = (distribucionPorAsesor[c.asesor_id] ??= {});
        d[c.categoria] = (d[c.categoria] ?? 0) + c.n;
      }
      suma += c.suma;
      n += c.con_puntaje;
      distribucion[c.categoria] = (distribucion[c.categoria] ?? 0) + c.n;
      if (c.asesor_id) {
        const a = (porAsesor[c.asesor_id] ??= { suma: 0, n: 0 });
        a.suma += c.suma;
        a.n += c.con_puntaje;
      }
    }
    r.set(u.location_id, {
      analisisId: u.id,
      periodoDesde: u.periodo_desde,
      periodoHasta: u.periodo_hasta,
      muestra: u.conversaciones_muestra,
      promedio: n ? suma / n : null,
      mensajesCalificados: n,
      porAsesor: Object.fromEntries(
        Object.entries(porAsesor)
          .filter(([, a]) => a.n)
          .map(([k, a]) => [k, { promedio: a.suma / a.n, mensajes: a.n }]),
      ),
      distribucion,
      distribucionPorAsesor,
    });
  }
  return r;
}

/** Mejor y peor mensaje de un asesor en el último análisis, con contexto y resultado (§6.7). */
export async function ejemplosAsesor(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  userId: string,
) {
  exigirModulo(ctx, 'detalle_asesores');
  exigirModulo(ctx, 'texto_mensajes');
  exigirSubcuenta(ctx, locationId);
  exigirAsesorPropio(ctx, userId);
  const resumen = (await ultimosAnalisis(db, [locationId])).get(locationId);
  if (!resumen) return { analisis: null, ejemplos: [] };
  const [ej] = await db
    .select()
    .from(tablas.ejemplosCalidad)
    .where(
      and(
        eq(tablas.ejemplosCalidad.analisisId, resumen.analisisId),
        eq(tablas.ejemplosCalidad.asesorId, userId),
        inArray(tablas.ejemplosCalidad.locationId, ctx.subcuentas),
      ),
    );
  const [sub] = await db
    .select()
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  const etapas = sub?.etapasCalidad?.length
    ? await db
        .select()
        .from(tablas.mapaEtapas)
        .where(
          and(
            eq(tablas.mapaEtapas.locationId, locationId),
            inArray(tablas.mapaEtapas.stageId, sub.etapasCalidad),
          ),
        )
    : [];
  const detalle = async (tipo: 'mejor' | 'peor', messageId: string | null) => {
    if (!messageId) return null;
    const r = await db.execute<{
      texto: string | null;
      fecha: Date;
      conversation_id: string;
      contact_id: string | null;
      categoria: string;
      puntaje: number | null;
      criterios: unknown;
      motivo: string | null;
    }>(sql`
      select m.texto, m.fecha, m.conversation_id, m.contact_id, c.categoria, c.puntaje, c.criterios, c.motivo
      from comercial.clasificaciones c join comercial.mensajes m on m.message_id = c.message_id
      where c.analisis_id = ${resumen.analisisId} and c.message_id = ${messageId} and m.location_id = ${locationId} limit 1`);
    const f = r.rows[0];
    if (!f) return null;
    const previo = await db.execute<{ texto: string | null }>(sql`
      select texto from comercial.mensajes where location_id = ${locationId} and conversation_id = ${f.conversation_id}
        and direccion = 'inbound' and fecha < ${f.fecha} order by fecha desc limit 1`);
    const respondio = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from comercial.mensajes where location_id = ${locationId} and conversation_id = ${f.conversation_id}
        and direccion = 'inbound' and fecha > ${f.fecha}`);
    const venta = f.contact_id
      ? await db.execute<{ n: number }>(
          sql`select count(*)::int as n from comercial.oportunidades where location_id = ${locationId} and contact_id = ${f.contact_id} and venta_en is not null and venta_cancelada_en is null`,
        )
      : { rows: [{ n: 0 }] };
    return {
      tipo,
      texto: f.texto,
      mensajePrevioCliente: previo.rows[0]?.texto ?? null,
      categoria: f.categoria,
      puntaje: f.puntaje,
      criterios: f.criterios,
      motivo: f.motivo,
      clienteRespondio: (respondio.rows[0]?.n ?? 0) > 0,
      huboVenta: (venta.rows[0]?.n ?? 0) > 0,
      conversationId: f.conversation_id,
      enlace: enlaceGhl(locationId, f.conversation_id),
      fecha: f.fecha,
    };
  };
  return {
    analisis: { ...resumen, etapas: etapas.map((e) => e.nombreOriginal) },
    ejemplos: ej
      ? [await detalle('mejor', ej.mejorMessageId), await detalle('peor', ej.peorMessageId)].filter(
          Boolean,
        )
      : [],
  };
}

/** Mensajes con menor puntaje del último análisis de la subcuenta ("Mensajes para mejorar"). */
export async function peoresMensajes(db: Db, ctx: ContextoAcceso, locationId: string, limite = 3) {
  exigirModulo(ctx, 'vista_subcuenta');
  exigirSubcuenta(ctx, locationId);
  if (ctx.modulos.texto_mensajes === 'ninguno') return { analisis: null, mensajes: [] };
  const resumen = (await ultimosAnalisis(db, [locationId])).get(locationId);
  if (!resumen) return { analisis: null, mensajes: [] };
  const r = await db.execute<{
    asesor: string | null;
    categoria: string;
    puntaje: number;
    criterios: Record<string, boolean> | null;
    motivo: string | null;
    texto: string | null;
  }>(sql`
    select a.nombre as asesor, c.categoria, c.puntaje, c.criterios, c.motivo, m.texto
    from comercial.clasificaciones c
    join comercial.mensajes m on m.message_id = c.message_id and m.location_id = ${locationId}
    left join comercial.asesores a on a.user_id = c.asesor_id
    where c.analisis_id = ${resumen.analisisId} and c.puntaje is not null and m.texto is not null
    order by c.puntaje asc, length(m.texto) desc
    limit ${limite}`);
  return { analisis: resumen, mensajes: r.rows };
}
