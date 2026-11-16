/** Horarios por asesor y ausencias (§4, pantalla Horarios). */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { configuracionTiempo, fechaLocal } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { exigirAsesorPropio, exigirModulo, exigirSubcuenta, type ContextoAcceso } from './acceso';
import { auditar } from './auditoria';
import { noEncontrado, prohibido, solicitudInvalida } from './errores';

/** El asesor solo cambia lo propio: el horario general y los feriados son de toda la subcuenta. */
function exigirPropioOGeneral(ctx: ContextoAcceso, userId: string | null) {
  if (userId) exigirAsesorPropio(ctx, userId);
  else if (ctx.rol === 'asesor') throw prohibido('Solo puedes cambiar tu propio horario.');
}

const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Hora inválida (HH:MM).');
const fecha = z.iso.date();

export const esquemaHorario = z.object({
  /** Nulo = horario general de la subcuenta. */
  userId: z.string().min(1).nullable(),
  vigenteDesde: fecha,
  tramos: z
    .array(z.object({ diaSemana: z.number().int().min(1).max(7), inicio: hora, fin: hora }))
    .max(50),
});

export const esquemaAusencia = z.object({
  userId: z.string().min(1).nullable(),
  inicio: z.iso.datetime({ offset: true }),
  fin: z.iso.datetime({ offset: true }),
  tipo: z.enum(['feriado', 'vacaciones', 'permiso']),
  motivo: z.string().max(200).optional(),
});

export const esquemaModoTiempo = z.object({ modo: z.enum(['laboral', 'corrido']) });

/**
 * Pide al worker recalcular el resumen diario de la subcuenta desde `desde` (se conserva la fecha más
 * antigua si ya había un pedido pendiente). El worker lo atiende en unos minutos.
 */
export async function marcarRecalculo(db: Db, locationId: string, desde: string): Promise<void> {
  await db.execute(sql`
    update comercial.subcuentas set horario_general = coalesce(horario_general, '{}'::jsonb) || jsonb_build_object(
      'recalcularDesde',
      case when horario_general->>'recalcularDesde' is not null and horario_general->>'recalcularDesde' < ${desde}
        then horario_general->>'recalcularDesde' else ${desde} end)
    where location_id = ${locationId}`);
}

/** Primer día con resumen de la subcuenta (para recalcular todo el historial). */
async function primerDiaResumen(db: Db, locationId: string): Promise<string | null> {
  const r = await db.execute<{ f: string | null }>(
    sql`select min(fecha)::text as f from comercial.resumen_diario where location_id = ${locationId}`,
  );
  return r.rows[0]?.f ?? null;
}

/**
 * Modo de tiempo de la subcuenta: horario laboral de cada asesor o tiempo corrido (24/7, para equipos
 * con horarios variables). Solo quien edita horarios de toda la subcuenta (no un asesor). Al cambiar,
 * se recalcula todo el historial del resumen diario.
 */
export async function guardarModoTiempo(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  e: z.infer<typeof esquemaModoTiempo>,
) {
  exigirModulo(ctx, 'horarios', 'editar');
  exigirSubcuenta(ctx, locationId);
  if (ctx.rol === 'asesor') throw prohibido('Solo puedes cambiar tu propio horario.');
  const [sub] = await db
    .select({
      horarioGeneral: tablas.subcuentas.horarioGeneral,
      zona: tablas.subcuentas.zonaHoraria,
    })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  if (!sub) throw noEncontrado('Subcuenta no encontrada.');
  const antes = configuracionTiempo(sub.horarioGeneral).modo;
  if (antes === e.modo) return { ok: true, recalculo: false };
  await db.execute(sql`
    update comercial.subcuentas set horario_general = coalesce(horario_general, '{}'::jsonb) || jsonb_build_object('modo', ${e.modo}::text)
    where location_id = ${locationId}`);
  await marcarRecalculo(
    db,
    locationId,
    (await primerDiaResumen(db, locationId)) ?? fechaLocal(new Date(), sub.zona),
  );
  await auditar(db, ctx.usuarioId, 'modo_tiempo', { locationId, antes, despues: e.modo });
  return { ok: true, recalculo: true };
}

export async function obtenerHorarios(db: Db, ctx: ContextoAcceso, locationId: string) {
  exigirModulo(ctx, 'horarios', 'ver');
  exigirSubcuenta(ctx, locationId);
  const filtroAsesor =
    ctx.rol === 'asesor' ? sql`and (user_id is null or user_id = ${ctx.userIdGhl ?? ''})` : sql``;
  const horarios = await db.execute(sql`
    select id, user_id, dia_semana, to_char(hora_inicio, 'HH24:MI') as inicio, to_char(hora_fin, 'HH24:MI') as fin, vigente_desde, vigente_hasta
    from comercial.horarios where location_id = ${locationId} ${filtroAsesor} order by user_id nulls first, vigente_desde, dia_semana, hora_inicio`);
  const ausencias = await db.execute(sql`
    select id, user_id, inicio, fin, tipo, motivo from comercial.ausencias
    where location_id = ${locationId} ${filtroAsesor} order by inicio desc limit 500`);
  return { horarios: horarios.rows, ausencias: ausencias.rows };
}

/**
 * Guarda un horario nuevo desde `vigenteDesde`: cierra la vigencia de los tramos anteriores del mismo
 * asesor (o del general) el día previo, para que los cálculos pasados no cambien.
 */
export async function guardarHorario(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  e: z.infer<typeof esquemaHorario>,
) {
  exigirModulo(ctx, 'horarios', 'editar');
  exigirSubcuenta(ctx, locationId);
  exigirPropioOGeneral(ctx, e.userId);
  for (const t of e.tramos)
    if (t.fin <= t.inicio) throw solicitudInvalida('Cada tramo debe terminar después de empezar.');
  for (let d = 1; d <= 7; d++) {
    const delDia = e.tramos
      .filter((t) => t.diaSemana === d)
      .sort((a, b) => a.inicio.localeCompare(b.inicio));
    for (let i = 1; i < delDia.length; i++) {
      if (delDia[i]!.inicio < delDia[i - 1]!.fin)
        throw solicitudInvalida('Hay tramos que se superponen en un mismo día.');
    }
  }
  const delAsesor = e.userId
    ? eq(tablas.horarios.userId, e.userId)
    : isNull(tablas.horarios.userId);
  const diaAnterior = new Date(Date.parse(`${e.vigenteDesde}T00:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  await db.transaction(async (tx) => {
    // Tramos que empezarían el mismo día o después se reemplazan.
    await tx
      .delete(tablas.horarios)
      .where(
        and(
          eq(tablas.horarios.locationId, locationId),
          delAsesor,
          sql`${tablas.horarios.vigenteDesde} >= ${e.vigenteDesde}`,
        ),
      );
    await tx
      .update(tablas.horarios)
      .set({ vigenteHasta: diaAnterior })
      .where(
        and(
          eq(tablas.horarios.locationId, locationId),
          delAsesor,
          sql`(${tablas.horarios.vigenteHasta} is null or ${tablas.horarios.vigenteHasta} >= ${e.vigenteDesde})`,
        ),
      );
    if (e.tramos.length) {
      await tx.insert(tablas.horarios).values(
        e.tramos.map((t) => ({
          userId: e.userId,
          locationId,
          diaSemana: t.diaSemana,
          horaInicio: t.inicio,
          horaFin: t.fin,
          vigenteDesde: e.vigenteDesde,
        })),
      );
    }
  });
  const [sub] = await db
    .select({ zona: tablas.subcuentas.zonaHoraria })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  if (e.vigenteDesde < fechaLocal(new Date(), sub?.zona ?? 'America/Lima'))
    await marcarRecalculo(db, locationId, e.vigenteDesde);
  await auditar(db, ctx.usuarioId, 'horario_guardado', {
    locationId,
    userId: e.userId,
    vigenteDesde: e.vigenteDesde,
    tramos: e.tramos.length,
  });
  return { ok: true };
}

export async function registrarAusencia(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  e: z.infer<typeof esquemaAusencia>,
) {
  exigirModulo(ctx, 'horarios', 'editar');
  exigirSubcuenta(ctx, locationId);
  exigirPropioOGeneral(ctx, e.userId);
  if (e.tipo === 'feriado' && e.userId)
    throw solicitudInvalida('Un feriado aplica a toda la subcuenta.');
  if (Date.parse(e.fin) <= Date.parse(e.inicio))
    throw solicitudInvalida('La ausencia debe terminar después de empezar.');
  const [a] = await db
    .insert(tablas.ausencias)
    .values({
      userId: e.userId,
      locationId,
      inicio: new Date(e.inicio),
      fin: new Date(e.fin),
      tipo: e.tipo,
      motivo: e.motivo ?? null,
    })
    .returning({ id: tablas.ausencias.id });
  await marcarSiEsPasado(db, locationId, new Date(e.inicio));
  await auditar(db, ctx.usuarioId, 'ausencia_registrada', { locationId, ...e });
  return { id: a!.id };
}

export async function eliminarAusencia(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  id: number,
) {
  exigirModulo(ctx, 'horarios', 'editar');
  exigirSubcuenta(ctx, locationId);
  const [a] = await db
    .select({ userId: tablas.ausencias.userId, inicio: tablas.ausencias.inicio })
    .from(tablas.ausencias)
    .where(and(eq(tablas.ausencias.id, id), eq(tablas.ausencias.locationId, locationId)))
    .limit(1);
  if (!a) throw noEncontrado('Ausencia no encontrada.');
  exigirPropioOGeneral(ctx, a.userId);
  await db
    .delete(tablas.ausencias)
    .where(and(eq(tablas.ausencias.id, id), eq(tablas.ausencias.locationId, locationId)));
  await marcarSiEsPasado(db, locationId, a.inicio);
  await auditar(db, ctx.usuarioId, 'ausencia_eliminada', { locationId, id });
  return { ok: true };
}

/** Una ausencia que empieza antes de ahora cambia indicadores ya calculados: se pide recálculo. */
async function marcarSiEsPasado(db: Db, locationId: string, inicio: Date): Promise<void> {
  if (inicio.getTime() >= Date.now()) return;
  const [sub] = await db
    .select({ zona: tablas.subcuentas.zonaHoraria })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  await marcarRecalculo(db, locationId, fechaLocal(inicio, sub?.zona ?? 'America/Lima'));
}
