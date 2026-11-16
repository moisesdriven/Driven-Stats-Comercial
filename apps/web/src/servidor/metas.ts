/** Metas y umbrales por subcuenta (§7). El semáforo se evalúa al leer, así que un cambio aplica de inmediato. */
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { metasDeSubcuenta, type Metas } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { exigirModulo, exigirSubcuenta, type ContextoAcceso } from './acceso';
import { auditar } from './auditoria';
import { noEncontrado } from './errores';

const tolerancia = z.object({ meta: z.literal(0), tolerancia: z.number().int().min(0).max(1000) });

export const esquemaMetas = z
  .object({
    tiempoRespuestaMin: z.number().positive().max(1440),
    sinResponder: tolerancia,
    pendientes: tolerancia,
    cumplimientoSeguimientoPct: z.number().min(1).max(100),
    intentosPorLead: z.number().positive().max(20),
    perdidosFaltaSeguimiento: tolerancia,
    calidad: z.number().min(1).max(5),
    respuestaEfectivaPct: z.number().min(1).max(100),
    abandonosPctMax: z.number().min(0).max(100),
    conversionPct: z.number().min(0.1).max(100),
    tiempoCierreDias: z.number().positive().max(365),
    ventasPorSemana: z.number().int().min(1).max(100_000).nullable(),
    toleranciaRelativa: z.number().min(0.05).max(0.5),
  })
  .strict();

export async function obtenerMetas(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
): Promise<Metas> {
  exigirModulo(ctx, 'metas', 'ver');
  exigirSubcuenta(ctx, locationId);
  const [s] = await db
    .select({ metas: tablas.subcuentas.metas })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  if (!s) throw noEncontrado('Subcuenta no encontrada.');
  return metasDeSubcuenta(s.metas);
}

export async function guardarMetas(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  metas: z.infer<typeof esquemaMetas>,
) {
  exigirModulo(ctx, 'metas', 'editar');
  exigirSubcuenta(ctx, locationId);
  const antes = await obtenerMetas(db, ctx, locationId);
  await db
    .update(tablas.subcuentas)
    .set({ metas })
    .where(eq(tablas.subcuentas.locationId, locationId));
  const cambios: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const k of Object.keys(metas) as (keyof Metas)[]) {
    if (JSON.stringify(antes[k]) !== JSON.stringify(metas[k]))
      cambios[k] = { antes: antes[k], despues: metas[k] };
  }
  if (Object.keys(cambios).length)
    await auditar(db, ctx.usuarioId, 'metas_guardadas', { locationId, cambios });
  return { ok: true, cambios: Object.keys(cambios).length };
}
