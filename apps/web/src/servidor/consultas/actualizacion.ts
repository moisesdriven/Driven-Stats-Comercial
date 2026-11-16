import { sql } from 'drizzle-orm';
import type { Db } from '@driven/db';

/** Fin de la última carga correcta entre las subcuentas indicadas ("actualizado hace N min"). */
export async function ultimaActualizacion(db: Db, subcuentas: string[]): Promise<Date | null> {
  if (!subcuentas.length) return null;
  const r = await db.execute<{ fin: Date | null }>(sql`
    select max(fin) as fin from comercial.sync_ejecuciones
    where estado = 'ok' and location_id in (${sql.join(
      subcuentas.map((x) => sql`${x}`),
      sql`, `,
    )})`);
  return r.rows[0]?.fin ? new Date(r.rows[0].fin) : null;
}
