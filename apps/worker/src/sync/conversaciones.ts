/** Conversaciones: asesor asignado (respaldo) y fecha de creación por contacto. */
import { sql } from 'drizzle-orm';
import type { Db } from '@driven/db';
import type { ClienteGhl } from '@driven/ghl';

export async function cargarConversaciones(
  db: Db,
  cliente: ClienteGhl,
  desde?: Date,
): Promise<{ conversaciones: number; ids: string[]; contactos: Set<string> }> {
  const ids: string[] = [];
  const contactos = new Set<string>();
  for await (const lote of cliente.conversaciones(desde ? { desde } : {})) {
    for (const c of lote) {
      if (!c.contactId) continue;
      ids.push(c.id);
      contactos.add(c.contactId);
      const creada = c.dateAdded ? new Date(c.dateAdded) : null;
      await db.execute(sql`
        insert into comercial.leads (location_id, contact_id, conversation_id, asignado_conversacion, conversacion_creada_en)
        values (${cliente.locationId}, ${c.contactId}, ${c.id}, ${c.assignedTo ?? null}, ${creada})
        on conflict (location_id, contact_id) do update set
          conversation_id = coalesce(comercial.leads.conversation_id, excluded.conversation_id),
          asignado_conversacion = coalesce(excluded.asignado_conversacion, comercial.leads.asignado_conversacion),
          conversacion_creada_en = least(comercial.leads.conversacion_creada_en, excluded.conversacion_creada_en),
          actualizado_en = now()`);
    }
  }
  return { conversaciones: ids.length, ids, contactos };
}
