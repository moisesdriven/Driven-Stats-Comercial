/**
 * Indicadores de un periodo a partir de `resumen_diario`. La vista general SIEMPRE suma los datos de
 * las subcuentas del usuario (nunca un cálculo aparte) y las medianas y promedios se calculan sobre
 * todos los registros, no como promedio de promedios (§8).
 */
import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  agregarPeriodo,
  calcularIndicadores,
  configuracionTiempo,
  evaluar,
  metasDeSubcuenta,
  sumarAcumulados,
  type Acumulado,
  type Metas,
} from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { exigirAsesorPropio, exigirModulo, exigirSubcuenta, type ContextoAcceso } from '../acceso';
import { ultimosAnalisis, type ResumenCalidad } from '../calidad';

/** Metadatos del análisis que se muestran junto al indicador ("Muestra de 1.000 conversaciones · octubre 2026"). */
const infoCalidad = (r: ResumenCalidad | undefined) =>
  r
    ? {
        analisisId: r.analisisId,
        periodoDesde: r.periodoDesde,
        periodoHasta: r.periodoHasta,
        muestra: r.muestra,
        distribucion: r.distribucion,
      }
    : null;

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;

function porDia(filas: { fecha: string; indicadores: unknown }[]): Map<string, Acumulado[]> {
  const m = new Map<string, Acumulado[]>();
  for (const f of filas) {
    const lista = m.get(f.fecha) ?? [];
    lista.push(f.indicadores as Acumulado);
    m.set(f.fecha, lista);
  }
  return m;
}

/** Suma por día y agrega el periodo (fotos del último día). */
function periodo(filas: { fecha: string; indicadores: unknown }[]): {
  acumulado: Acumulado;
  ventasPorDia: { fecha: string; ventas: number; monto: number }[];
} {
  const dias = [...porDia(filas).entries()].sort(([a], [b]) => a.localeCompare(b));
  const diarios = dias.map(([, lista]) => sumarAcumulados(lista));
  return {
    acumulado: agregarPeriodo(diarios),
    ventasPorDia: dias.map(([fecha], i) => ({
      fecha,
      ventas: diarios[i]!.ventas,
      monto: diarios[i]!.montoVentas,
    })),
  };
}

function resultado(a: Acumulado, metas: Metas, dias: number, calidad: number | null = null) {
  const indicadores = calcularIndicadores(a, dias, calidad);
  return { indicadores, evaluacion: evaluar(indicadores, metas, dias) };
}

/** Indicadores de una subcuenta y de cada asesor. */
export async function indicadoresSubcuenta(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  desde: string,
  hasta: string,
) {
  exigirModulo(ctx, 'vista_subcuenta');
  exigirSubcuenta(ctx, locationId);
  return calcularSubcuenta(db, ctx, locationId, desde, hasta);
}

/**
 * Módulo Asesores: los asesores de una subcuenta con sus indicadores. Exige el permiso de detalle
 * de asesores (no el de la vista de subcuenta); un asesor solo ve su propia fila.
 */
export async function asesoresSubcuenta(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  desde: string,
  hasta: string,
) {
  exigirModulo(ctx, 'detalle_asesores');
  exigirSubcuenta(ctx, locationId);
  const d = await calcularSubcuenta(db, ctx, locationId, desde, hasta);
  return {
    subcuenta: d.subcuenta,
    corrido: d.corrido,
    asesores:
      ctx.rol === 'asesor' ? d.asesores.filter((a) => a.asesorId === ctx.userIdGhl) : d.asesores,
  };
}

/** Sin revisar permisos: solo para las funciones exportadas de arriba, que ya los revisaron. */
async function calcularSubcuenta(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  desde: string,
  hasta: string,
) {
  const [sub] = await db
    .select()
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  const metas = metasDeSubcuenta(sub?.metas);
  const dias = diasEntre(desde, hasta);
  const filas = await db
    .select()
    .from(tablas.resumenDiario)
    .where(
      and(
        eq(tablas.resumenDiario.locationId, locationId),
        inArray(tablas.resumenDiario.locationId, ctx.subcuentas),
        between(tablas.resumenDiario.fecha, desde, hasta),
        isNull(tablas.resumenDiario.canal),
      ),
    )
    .orderBy(asc(tablas.resumenDiario.fecha));
  const total = periodo(filas.filter((f) => f.asesorId === null));
  const asesoresIds = [
    ...new Set(filas.map((f) => f.asesorId).filter((x): x is string => x !== null)),
  ];
  const nombres = asesoresIds.length
    ? await db.select().from(tablas.asesores).where(inArray(tablas.asesores.userId, asesoresIds))
    : [];
  const motivos = await db
    .select()
    .from(tablas.motivosPerdida)
    .where(eq(tablas.motivosPerdida.locationId, locationId));
  const calidad = (await ultimosAnalisis(db, [locationId])).get(locationId);
  return {
    subcuenta: { locationId, nombre: sub?.nombre ?? locationId },
    metas,
    corrido: configuracionTiempo(sub?.horarioGeneral).modo === 'corrido',
    desde,
    hasta,
    ...resultado(total.acumulado, metas, dias, calidad?.promedio ?? null),
    calidad: infoCalidad(calidad),
    ventasPorDia: total.ventasPorDia,
    motivosPerdida: Object.fromEntries(motivos.map((m) => [m.motivoId, m.nombre])),
    asesores: asesoresIds.map((id) => ({
      asesorId: id,
      nombre: nombres.find((n) => n.userId === id)?.nombre ?? id,
      ...resultado(
        periodo(filas.filter((f) => f.asesorId === id)).acumulado,
        metas,
        dias,
        calidad?.porAsesor[id]?.promedio ?? null,
      ),
    })),
  };
}

/** Indicadores de un asesor (el asesor solo ve los propios) y el promedio de la subcuenta para comparar. */
export async function indicadoresAsesor(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  userId: string,
  desde: string,
  hasta: string,
) {
  exigirModulo(ctx, 'detalle_asesores');
  exigirSubcuenta(ctx, locationId);
  exigirAsesorPropio(ctx, userId);
  const [sub] = await db
    .select()
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  const metas = metasDeSubcuenta(sub?.metas);
  const dias = diasEntre(desde, hasta);
  const filtro = and(
    eq(tablas.resumenDiario.locationId, locationId),
    inArray(tablas.resumenDiario.locationId, ctx.subcuentas),
    between(tablas.resumenDiario.fecha, desde, hasta),
    isNull(tablas.resumenDiario.canal),
  );
  const propias = await db
    .select()
    .from(tablas.resumenDiario)
    .where(
      and(
        filtro,
        eq(tablas.resumenDiario.asesorId, ctx.rol === 'asesor' ? (ctx.userIdGhl ?? '-') : userId),
      ),
    );
  const total = await db
    .select()
    .from(tablas.resumenDiario)
    .where(and(filtro, isNull(tablas.resumenDiario.asesorId)));
  const [asesor] = await db
    .select()
    .from(tablas.asesores)
    .where(eq(tablas.asesores.userId, userId));
  const calidad = (await ultimosAnalisis(db, [locationId])).get(locationId);
  // Asesores con leads en el periodo: para comparar contra el promedio por asesor de la subcuenta.
  const conLeads = await db.execute<{ n: number }>(sql`
    select count(distinct asesor_id)::int as n from comercial.resumen_diario
    where location_id = ${locationId} and asesor_id is not null and canal is null
      and fecha between ${desde} and ${hasta}
      and (indicadores->>'leadsRecibidos')::int > 0`);
  return {
    asesor: { userId, nombre: asesor?.nombre ?? userId },
    metas,
    corrido: configuracionTiempo(sub?.horarioGeneral).modo === 'corrido',
    asesoresConLeads: conLeads.rows[0]?.n ?? 0,
    distribucionCalidad: calidad?.distribucionPorAsesor[userId] ?? null,
    desde,
    hasta,
    ...resultado(
      periodo(propias).acumulado,
      metas,
      dias,
      calidad?.porAsesor[userId]?.promedio ?? null,
    ),
    calidad: infoCalidad(calidad),
    subcuenta: resultado(periodo(total).acumulado, metas, dias, calidad?.promedio ?? null)
      .indicadores,
  };
}

/**
 * Vista general: suma de las subcuentas del usuario (el dueño ve solo las suyas). Con `canal`, usa
 * las filas de ese canal; la calidad no se mide por canal, así que en ese caso queda sin dato.
 */
export async function vistaGeneral(
  db: Db,
  ctx: ContextoAcceso,
  desde: string,
  hasta: string,
  canal: string | null = null,
) {
  exigirModulo(ctx, 'vista_general');
  if (!ctx.subcuentas.length)
    return { desde, hasta, subcuentas: [], total: null, ventasPorDia: [], canales: [] };
  const dias = diasEntre(desde, hasta);
  const subs = await db
    .select()
    .from(tablas.subcuentas)
    .where(inArray(tablas.subcuentas.locationId, ctx.subcuentas));
  const filas = await db
    .select()
    .from(tablas.resumenDiario)
    .where(
      and(
        inArray(tablas.resumenDiario.locationId, ctx.subcuentas),
        isNull(tablas.resumenDiario.asesorId),
        between(tablas.resumenDiario.fecha, desde, hasta),
        canal ? eq(tablas.resumenDiario.canal, canal) : isNull(tablas.resumenDiario.canal),
      ),
    )
    .orderBy(asc(tablas.resumenDiario.fecha));
  // Canales con datos en las subcuentas del usuario (opciones del filtro).
  const canales = await db.execute<{ canal: string }>(sql`
    select distinct canal from comercial.resumen_diario
    where canal is not null and asesor_id is null
      and location_id in (${sql.join(
        ctx.subcuentas.map((x) => sql`${x}`),
        sql`, `,
      )})
    order by canal`);
  const calidades = canal
    ? new Map<string, ResumenCalidad>()
    : await ultimosAnalisis(
        db,
        subs.map((s) => s.locationId),
      );
  const porSubcuenta = subs.map((s) => ({
    locationId: s.locationId,
    nombre: s.nombre,
    ...resultado(
      periodo(filas.filter((f) => f.locationId === s.locationId)).acumulado,
      metasDeSubcuenta(s.metas),
      dias,
      calidades.get(s.locationId)?.promedio ?? null,
    ),
    calidad: infoCalidad(calidades.get(s.locationId)),
    metas: metasDeSubcuenta(s.metas),
  }));
  // Calidad de la agencia: promedio ponderado por mensajes calificados (no promedio de promedios).
  const conCalidad = [...calidades.values()].filter(
    (c) => c.promedio !== null && c.mensajesCalificados,
  );
  const mensajes = conCalidad.reduce((t, c) => t + c.mensajesCalificados, 0);
  const calidadAgencia = mensajes
    ? conCalidad.reduce((t, c) => t + c.promedio! * c.mensajesCalificados, 0) / mensajes
    : null;
  // Metas de la agencia: las por defecto, con la meta de ventas como suma de las subcuentas.
  const metasSubs = subs.map((s) => metasDeSubcuenta(s.metas));
  const metasAgencia: Metas = {
    ...metasDeSubcuenta(null),
    ventasPorSemana: metasSubs.every((m) => m.ventasPorSemana !== null)
      ? metasSubs.reduce((t, m) => t + (m.ventasPorSemana ?? 0), 0)
      : null,
  };
  const total = periodo(filas);
  return {
    desde,
    hasta,
    metas: metasAgencia,
    corrido:
      subs.length > 0 &&
      subs.every((s) => configuracionTiempo(s.horarioGeneral).modo === 'corrido'),
    ...resultado(total.acumulado, metasAgencia, dias, calidadAgencia),
    ventasPorDia: total.ventasPorDia,
    subcuentas: porSubcuenta,
    canal,
    canales: canales.rows.map((r) => r.canal),
  };
}
