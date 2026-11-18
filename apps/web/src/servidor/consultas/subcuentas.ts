/**
 * Consultas de datos por subcuenta. TODAS filtran por las subcuentas del usuario en el SQL
 * (no solo con una validación previa), para que un error en la validación no exponga datos.
 */
import { and, asc, between, eq, inArray, isNull } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import { exigirAsesorPropio, exigirModulo, exigirSubcuenta, type ContextoAcceso } from '../acceso';

export async function listarSubcuentas(db: Db, ctx: ContextoAcceso) {
  if (ctx.subcuentas.length === 0) return [];
  return db
    .select({
      locationId: tablas.subcuentas.locationId,
      nombre: tablas.subcuentas.nombre,
      zonaHoraria: tablas.subcuentas.zonaHoraria,
      activa: tablas.subcuentas.activa,
    })
    .from(tablas.subcuentas)
    .where(inArray(tablas.subcuentas.locationId, ctx.subcuentas))
    .orderBy(asc(tablas.subcuentas.nombre));
}

/** Resumen diario de toda la subcuenta en un rango de fechas (YYYY-MM-DD). */
export async function resumenSubcuenta(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  desde: string,
  hasta: string,
) {
  exigirModulo(ctx, 'vista_subcuenta');
  exigirSubcuenta(ctx, locationId);
  return db
    .select()
    .from(tablas.resumenDiario)
    .where(
      and(
        eq(tablas.resumenDiario.locationId, locationId),
        inArray(tablas.resumenDiario.locationId, ctx.subcuentas),
        isNull(tablas.resumenDiario.asesorId),
        between(tablas.resumenDiario.fecha, desde, hasta),
        isNull(tablas.resumenDiario.canal),
      ),
    )
    .orderBy(asc(tablas.resumenDiario.fecha));
}

/** Resumen diario de un asesor en una subcuenta. El asesor solo puede ver el propio. */
export async function resumenAsesor(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  userIdGhl: string,
  desde: string,
  hasta: string,
) {
  exigirModulo(ctx, 'detalle_asesores');
  exigirSubcuenta(ctx, locationId);
  exigirAsesorPropio(ctx, userIdGhl);
  const filtroAsesor = ctx.rol === 'asesor' ? (ctx.userIdGhl ?? '') : userIdGhl;
  return db
    .select()
    .from(tablas.resumenDiario)
    .where(
      and(
        eq(tablas.resumenDiario.locationId, locationId),
        inArray(tablas.resumenDiario.locationId, ctx.subcuentas),
        eq(tablas.resumenDiario.asesorId, filtroAsesor),
        between(tablas.resumenDiario.fecha, desde, hasta),
        isNull(tablas.resumenDiario.canal),
      ),
    )
    .orderBy(asc(tablas.resumenDiario.fecha));
}
