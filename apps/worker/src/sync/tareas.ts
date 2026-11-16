import { sql } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import type { ClienteGhl } from '@driven/ghl';
import { fechaONula } from './util';

/** Tareas de seguimiento de la subcuenta (para pendientes y vencidos). */
export async function cargarTareas(db: Db, cliente: ClienteGhl): Promise<number> {
  let n = 0;
  for await (const lote of cliente.tareas()) {
    for (const t of lote) {
      const id = t.id ?? t._id;
      if (!id) continue;
      const fila = {
        taskId: id,
        locationId: cliente.locationId,
        contactId: t.contactId ?? null,
        venceEn: fechaONula(t.dueDate),
        completada: Boolean(t.completed),
      };
      await db
        .insert(tablas.tareas)
        .values(fila)
        .onConflictDoUpdate({ target: tablas.tareas.taskId, set: fila });
      n++;
    }
  }
  await db.execute(sql`select 1`);
  return n;
}
