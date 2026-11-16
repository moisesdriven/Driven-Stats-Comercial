/** Usuarios (asesores), pipelines (mapa de etapas) y motivos de pérdida de una subcuenta. */
import { sql } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import type { ClienteGhl } from '@driven/ghl';

export async function sincronizarCatalogos(
  db: Db,
  cliente: ClienteGhl,
): Promise<{ asesores: number; etapas: number; motivos: number }> {
  const loc = cliente.locationId;
  const [usuarios, pipelines, motivos] = await Promise.all([
    cliente.usuarios(),
    cliente.pipelines(),
    cliente.motivosPerdida(),
  ]);

  for (const u of usuarios) {
    const nombre = u.name?.trim() || `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || u.id;
    await db
      .insert(tablas.asesores)
      .values({ userId: u.id, nombre, correo: u.email ?? null })
      .onConflictDoUpdate({
        target: tablas.asesores.userId,
        set: { nombre, correo: u.email ?? null },
      });
    await db
      .insert(tablas.asesorSubcuenta)
      .values({ userId: u.id, locationId: loc, activo: !u.deleted })
      .onConflictDoUpdate({
        target: [tablas.asesorSubcuenta.userId, tablas.asesorSubcuenta.locationId],
        set: { activo: !u.deleted },
      });
  }

  let etapas = 0;
  for (const p of pipelines) {
    for (const s of p.stages) {
      etapas++;
      // El mapa a etapa estándar lo define la configuración: aquí solo se actualiza el nombre.
      await db
        .insert(tablas.mapaEtapas)
        .values({ locationId: loc, pipelineId: p.id, stageId: s.id, nombreOriginal: s.name })
        .onConflictDoUpdate({
          target: [
            tablas.mapaEtapas.locationId,
            tablas.mapaEtapas.pipelineId,
            tablas.mapaEtapas.stageId,
          ],
          set: { nombreOriginal: s.name },
        });
    }
  }

  for (const m of motivos) {
    await db
      .insert(tablas.motivosPerdida)
      .values({ locationId: loc, motivoId: m.id, nombre: m.name })
      .onConflictDoUpdate({
        target: [tablas.motivosPerdida.locationId, tablas.motivosPerdida.motivoId],
        set: { nombre: m.name },
      });
  }
  await db.execute(sql`select 1`);
  return { asesores: usuarios.length, etapas, motivos: motivos.length };
}

/** Pipelines de la subcuenta con su mapa: stageId → etapa estándar, y nombre → stageId por pipeline. */
export async function cargarMapa(db: Db, locationId: string) {
  const filas = await db
    .select()
    .from(tablas.mapaEtapas)
    .where(sql`${tablas.mapaEtapas.locationId} = ${locationId}`);
  const estandarPorEtapa = new Map<string, string | null>();
  const etapaPorNombre = new Map<string, string>();
  for (const f of filas) {
    estandarPorEtapa.set(f.stageId, f.etapaEstandar);
    etapaPorNombre.set(`${f.pipelineId}|${f.nombreOriginal.trim().toLowerCase()}`, f.stageId);
  }
  return { estandarPorEtapa, etapaPorNombre };
}
