/** Horarios por asesor y ausencias (§4, pantalla Horarios). */
import { and, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
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
    .select({ userId: tablas.ausencias.userId })
    .from(tablas.ausencias)
    .where(and(eq(tablas.ausencias.id, id), eq(tablas.ausencias.locationId, locationId)))
    .limit(1);
  if (!a) throw noEncontrado('Ausencia no encontrada.');
  exigirPropioOGeneral(ctx, a.userId);
  await db
    .delete(tablas.ausencias)
    .where(and(eq(tablas.ausencias.id, id), eq(tablas.ausencias.locationId, locationId)));
  await auditar(db, ctx.usuarioId, 'ausencia_eliminada', { locationId, id });
  return { ok: true };
}
