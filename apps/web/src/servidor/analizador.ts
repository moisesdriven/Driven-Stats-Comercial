/**
 * Analizador a pedido (decisión del cliente, 16 nov 2026): análisis de calidad con filtros elegidos
 * por el administrador, aparte de la medición mensual. Filtra por la etapa en la que el lead está hoy
 * y por la fecha de creación del lead, con 500–1.000 conversaciones repartidas por igual entre los
 * asesores (o en proporción). Califica toda la conversación con su propio modelo (Sonnet 5.5 por
 * defecto) y su propio tope mensual. No cambia los indicadores de calidad.
 */
import { randomBytes } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { VERSION_RUBRICA } from '@driven/core';
import {
  configuracionAnalizador,
  configuracionCalidad,
  gastoDelMes,
  limitesManuales,
  prepararAnalizador,
  tablas,
  TAMANO_ANALIZADOR,
  type Db,
  type FiltrosAnalizador,
} from '@driven/db';
import { exigirAdmin, exigirSubcuenta, type ContextoAcceso } from './acceso';
import { auditar } from './auditoria';
import { ErrorHttp, noEncontrado, solicitudInvalida } from './errores';

export const esquemaAnalizador = z.object({
  subcuenta: z.string().min(1),
  /** Etapas del pipeline en las que el lead está hoy. */
  etapas: z.array(z.string().min(1)).min(1, 'Elige al menos una etapa.').max(50),
  tamano: z
    .number()
    .int()
    .min(TAMANO_ANALIZADOR.minimo, `Mínimo ${TAMANO_ANALIZADOR.minimo} conversaciones.`)
    .max(TAMANO_ANALIZADOR.maximo, `Máximo ${TAMANO_ANALIZADOR.maximo} conversaciones.`),
  distribucion: z.enum(['equitativa', 'proporcional']).default('equitativa'),
  /** Rango de fechas de creación de los leads (inclusive). */
  creadosDesde: z.iso.date(),
  creadosHasta: z.iso.date(),
});
export type EntradaAnalizador = z.infer<typeof esquemaAnalizador>;

const rango = (desde: string, hasta: string): [Date, Date] => [
  new Date(`${desde}T00:00:00Z`),
  new Date(Date.parse(`${hasta}T00:00:00Z`) + 86_400_000),
];

/**
 * Lo que se muestra antes de lanzar: conversaciones que cumplen los filtros, cuántas entran por
 * asesor, mensajes, costo estimado (y máximo sin caché) y gasto del mes del analizador.
 */
export async function estimarAnalizador(db: Db, ctx: ContextoAcceso, e: EntradaAnalizador) {
  exigirAdmin(ctx);
  exigirSubcuenta(ctx, e.subcuenta);
  if (e.creadosDesde > e.creadosHasta) throw solicitudInvalida('Rango de fechas inválido.');
  const validas = await db
    .select({ stageId: tablas.mapaEtapas.stageId })
    .from(tablas.mapaEtapas)
    .where(
      and(
        eq(tablas.mapaEtapas.locationId, e.subcuenta),
        inArray(tablas.mapaEtapas.stageId, e.etapas),
      ),
    );
  if (validas.length !== new Set(e.etapas).size)
    throw solicitudInvalida('Alguna etapa no pertenece al pipeline de la subcuenta.');
  const cfg = configuracionCalidad();
  const cfgA = configuracionAnalizador(cfg);
  const [creadosDesde, creadosHasta] = rango(e.creadosDesde, e.creadosHasta);
  const filtros: FiltrosAnalizador = {
    etapas: e.etapas,
    tamano: e.tamano,
    distribucion: e.distribucion,
  };
  const p = await prepararAnalizador(
    db,
    { locationId: e.subcuenta, filtros, creadosDesde, creadosHasta },
    cfg,
  );
  const elegiblesPorAsesor = Object.fromEntries(
    [...p.universo.porAsesor].map(([a, l]) => [a, l.length]),
  );
  const muestraPorAsesor: Record<string, number> = {};
  for (const m of p.muestra) muestraPorAsesor[m.asesorId] = (muestraPorAsesor[m.asesorId] ?? 0) + 1;
  return {
    subcuenta: e.subcuenta,
    filtros,
    creadosDesde: e.creadosDesde,
    creadosHasta: e.creadosHasta,
    conversacionesElegibles: p.universo.conversaciones,
    muestra: p.muestra.length,
    elegiblesPorAsesor,
    muestraPorAsesor,
    mensajesEstimados: p.solicitudes.reduce((t, x) => t + x.mensajes + x.porRegla.length, 0),
    mensajesPorRegla: p.solicitudes.reduce((t, x) => t + x.porRegla.length, 0),
    conversacionesReutilizadas: p.solicitudes.filter((x) => x.reutilizarDe !== null).length,
    descartes: { ...p.descartes, sinMensajesCalificables: p.sinMensajes.length },
    costoEstimadoUsd: p.estimacion.costoUsd,
    costoMaximoUsd: p.estimacion.costoMaximoUsd,
    modelo: cfgA.modelo,
    gastoDelMesUsd: await gastoDelMes(db, new Date(), true),
    topeMensualUsd: cfgA.topeMensualUsd,
    enCurso: (await limitesManuales(db, e.subcuenta, new Date(), true)).enCurso,
  };
}

/**
 * Lanza el analizador (la revalidación con contraseña o 2FA la hace la ruta antes). Rechaza si ya
 * hay uno en curso en la subcuenta, si no hay conversaciones o si el peor caso superaría el tope del
 * analizador. Queda en auditoría con los filtros y el costo estimado.
 */
export async function lanzarAnalizador(db: Db, ctx: ContextoAcceso, e: EntradaAnalizador) {
  const est = await estimarAnalizador(db, ctx, e);
  if (est.enCurso)
    throw new ErrorHttp(
      409,
      'La subcuenta ya tiene un análisis del analizador en curso.',
      'analisis_en_curso',
    );
  if (!est.conversacionesElegibles)
    throw solicitudInvalida('Ninguna conversación cumple los filtros elegidos.');
  if (est.gastoDelMesUsd + est.costoMaximoUsd > est.topeMensualUsd)
    throw new ErrorHttp(
      409,
      `El análisis costaría unos US$ ${est.costoEstimadoUsd.toFixed(2)} (hasta US$ ${est.costoMaximoUsd.toFixed(2)} si la caché no funciona) y podría superar el tope mensual del analizador (US$ ${est.topeMensualUsd}; gastado: US$ ${est.gastoDelMesUsd.toFixed(2)}).`,
      'tope_gasto',
    );
  const [a] = await db
    .insert(tablas.analisisCalidad)
    .values({
      locationId: e.subcuenta,
      tipo: 'analizador',
      lanzadoPor: ctx.usuarioId,
      periodoDesde: e.creadosDesde,
      periodoHasta: e.creadosHasta,
      filtros: est.filtros,
      semilla: randomBytes(8).toString('hex'),
      estado: 'solicitado',
      modelo: est.modelo,
      costoEstimado: est.costoEstimadoUsd,
      versionRubrica: VERSION_RUBRICA,
    })
    .returning({ id: tablas.analisisCalidad.id });
  await auditar(db, ctx.usuarioId, 'calidad_analizador_lanzado', {
    subcuenta: e.subcuenta,
    filtros: est.filtros,
    creadosDesde: e.creadosDesde,
    creadosHasta: e.creadosHasta,
    costoEstimadoUsd: est.costoEstimadoUsd,
    costoMaximoUsd: est.costoMaximoUsd,
    analisis: a!.id,
  });
  return { analisis: a!.id, costoEstimadoUsd: est.costoEstimadoUsd };
}

/**
 * Resultado de un análisis del analizador: filtros, estado y costo, promedio, por asesor (promedio,
 * mensajes y conversaciones), distribución por categoría, cumplimiento de cada criterio y el mejor
 * y peor mensaje por asesor.
 */
export async function resultadoAnalizador(db: Db, ctx: ContextoAcceso, id: number) {
  exigirAdmin(ctx);
  const [a] = await db
    .select()
    .from(tablas.analisisCalidad)
    .where(and(eq(tablas.analisisCalidad.id, id), eq(tablas.analisisCalidad.tipo, 'analizador')));
  if (!a) throw noEncontrado('Análisis no encontrado.');
  exigirSubcuenta(ctx, a.locationId);
  const porAsesor = await db.execute<{
    asesor_id: string | null;
    promedio: string | null;
    mensajes: number;
    conversaciones: number;
  }>(sql`
    select asesor_id, avg(puntaje)::numeric(4,2)::text as promedio, count(puntaje)::int as mensajes,
      count(distinct conversation_id)::int as conversaciones
    from comercial.clasificaciones where analisis_id = ${id} group by 1 order by 1`);
  const categorias = await db.execute<{
    categoria: string;
    n: number;
    promedio: string | null;
  }>(sql`
    select categoria, count(*)::int as n, avg(puntaje)::numeric(4,2)::text as promedio
    from comercial.clasificaciones where analisis_id = ${id} group by 1 order by 2 desc`);
  const criterios = await db.execute<{ criterio: string; pct: string | null }>(sql`
    select k as criterio, round(100.0 * avg((criterios->>k)::boolean::int), 1)::text as pct
    from comercial.clasificaciones, unnest(array['responde','personalizado','siguiente_paso','tono','extension']) k
    where analisis_id = ${id} and categoria <> 'multimedia' group by 1`);
  const total = await db.execute<{ promedio: string | null; mensajes: number }>(sql`
    select avg(puntaje)::numeric(4,2)::text as promedio, count(puntaje)::int as mensajes
    from comercial.clasificaciones where analisis_id = ${id}`);
  const ejemplos = await db
    .select()
    .from(tablas.ejemplosCalidad)
    .where(eq(tablas.ejemplosCalidad.analisisId, id));
  return {
    // Sin la semilla ni los lotes (internos).
    analisis: (({ semilla: _s, batchIds: _b, ...x }) => x)(a),
    promedio: total.rows[0]?.promedio ? Number(total.rows[0].promedio) : null,
    mensajesConPuntaje: total.rows[0]?.mensajes ?? 0,
    porAsesor: porAsesor.rows.map((r) => ({
      asesorId: r.asesor_id,
      promedio: r.promedio ? Number(r.promedio) : null,
      mensajes: r.mensajes,
      conversaciones: r.conversaciones,
    })),
    categorias: categorias.rows.map((r) => ({
      categoria: r.categoria,
      mensajes: r.n,
      promedio: r.promedio ? Number(r.promedio) : null,
    })),
    criterios: Object.fromEntries(criterios.rows.map((r) => [r.criterio, Number(r.pct)])),
    ejemplos: ejemplos.map((e) => ({
      asesorId: e.asesorId,
      mejorMessageId: e.mejorMessageId,
      peorMessageId: e.peorMessageId,
    })),
  };
}
