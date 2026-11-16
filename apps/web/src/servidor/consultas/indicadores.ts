/**
 * Indicadores de un periodo a partir de `resumen_diario`. La vista general SIEMPRE suma los datos de
 * las subcuentas del usuario (nunca un cálculo aparte) y las medianas y promedios se calculan sobre
 * todos los registros, no como promedio de promedios (§8).
 */
import { and, asc, between, eq, inArray, isNull } from 'drizzle-orm';
import {
  agregarPeriodo,
  calcularIndicadores,
  evaluar,
  metasDeSubcuenta,
  sumarAcumulados,
  type Acumulado,
  type Metas,
} from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { exigirAsesorPropio, exigirModulo, exigirSubcuenta, type ContextoAcceso } from '../acceso';

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

function resultado(a: Acumulado, metas: Metas, dias: number) {
  const indicadores = calcularIndicadores(a, dias);
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
  return {
    subcuenta: { locationId, nombre: sub?.nombre ?? locationId },
    desde,
    hasta,
    ...resultado(total.acumulado, metas, dias),
    ventasPorDia: total.ventasPorDia,
    motivosPerdida: Object.fromEntries(motivos.map((m) => [m.motivoId, m.nombre])),
    asesores: asesoresIds.map((id) => ({
      asesorId: id,
      nombre: nombres.find((n) => n.userId === id)?.nombre ?? id,
      ...resultado(periodo(filas.filter((f) => f.asesorId === id)).acumulado, metas, dias),
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
  return {
    asesor: { userId, nombre: asesor?.nombre ?? userId },
    desde,
    hasta,
    ...resultado(periodo(propias).acumulado, metas, dias),
    subcuenta: resultado(periodo(total).acumulado, metas, dias).indicadores,
  };
}

/** Vista general: suma de las subcuentas del usuario (el dueño ve solo las suyas). */
export async function vistaGeneral(db: Db, ctx: ContextoAcceso, desde: string, hasta: string) {
  exigirModulo(ctx, 'vista_general');
  if (!ctx.subcuentas.length)
    return { desde, hasta, subcuentas: [], total: null, ventasPorDia: [] };
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
      ),
    )
    .orderBy(asc(tablas.resumenDiario.fecha));
  const porSubcuenta = subs.map((s) => ({
    locationId: s.locationId,
    nombre: s.nombre,
    ...resultado(
      periodo(filas.filter((f) => f.locationId === s.locationId)).acumulado,
      metasDeSubcuenta(s.metas),
      dias,
    ),
  }));
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
    ...resultado(total.acumulado, metasAgencia, dias),
    ventasPorDia: total.ventasPorDia,
    subcuentas: porSubcuenta,
  };
}
