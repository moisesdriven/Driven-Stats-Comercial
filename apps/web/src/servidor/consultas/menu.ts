import { sql } from 'drizzle-orm';
import type { EstadoSemaforo } from '@driven/core';
import type { Db } from '@driven/db';
import type { ContextoAcceso } from '../acceso';

export interface SubcuentaMenu {
  locationId: string;
  nombre: string;
  /** Peor estado de etapa del último día calculado (para el punto del menú). */
  peor: EstadoSemaforo | null;
}

/** Subcuentas del usuario con el semáforo de su último resumen diario. */
export async function subcuentasMenu(db: Db, ctx: ContextoAcceso): Promise<SubcuentaMenu[]> {
  if (!ctx.subcuentas.length) return [];
  const ids = sql.join(
    ctx.subcuentas.map((x) => sql`${x}`),
    sql`, `,
  );
  const r = await db.execute<{
    location_id: string;
    nombre: string;
    estados: Record<string, EstadoSemaforo | null> | null;
  }>(sql`
    select s.location_id, s.nombre, r.estados_etapa as estados
    from comercial.subcuentas s
    left join lateral (
      select estados_etapa from comercial.resumen_diario
      where location_id = s.location_id and asesor_id is null and canal is null
      order by fecha desc limit 1
    ) r on true
    where s.location_id in (${ids}) and s.activa
    order by s.nombre`);
  const orden: (EstadoSemaforo | null)[] = [null, 'verde', 'amarillo', 'rojo'];
  return r.rows.map((f) => ({
    locationId: f.location_id,
    nombre: f.nombre,
    peor: Object.values(f.estados ?? {}).reduce<EstadoSemaforo | null>(
      (p, e) => (orden.indexOf(e ?? null) > orden.indexOf(p) ? (e ?? null) : p),
      null,
    ),
  }));
}
