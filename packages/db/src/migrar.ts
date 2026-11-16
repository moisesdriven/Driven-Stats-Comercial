import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { MATRIZ_POR_DEFECTO, MODULOS, ROLES } from '@driven/core';
import type { Db } from './cliente';
import { permisosRol } from './esquema/index';

/** Carpeta de migraciones junto al paquete. Se importa aparte (`@driven/db/migrar`) para que la web no la empaquete. */
export const CARPETA_MIGRACIONES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'migraciones',
);

/**
 * Aplica las migraciones pendientes del esquema `comercial` y siembra la matriz de permisos por rol.
 *
 * Usa los archivos que genera drizzle-kit, pero no el migrador de Drizzle: ese ejecuta
 * `CREATE SCHEMA`, y el rol `comercial_migrador` no tiene (a propósito) permiso para crear esquemas
 * en la base compartida. Cada migración se aplica en su propia transacción, con un candado
 * consultivo para que dos procesos no migren a la vez.
 */
export async function migrar(db: Db, carpeta = CARPETA_MIGRACIONES): Promise<string[]> {
  const migraciones = readMigrationFiles({ migrationsFolder: carpeta });
  const aplicadas: string[] = [];

  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('driven-comercial:migraciones'))`);
    await tx.execute(sql`
      create table if not exists comercial.__migraciones (
        id serial primary key,
        hash text not null,
        created_at bigint not null
      )`);
    const r = await tx.execute<{ created_at: string | null }>(
      sql`select max(created_at)::text as created_at from comercial.__migraciones`,
    );
    const ultima = Number(r.rows[0]?.created_at ?? 0);

    for (const m of migraciones) {
      if (m.folderMillis <= ultima) continue;
      for (const sentencia of m.sql) {
        if (sentencia.trim()) await tx.execute(sql.raw(sentencia));
      }
      await tx.execute(
        sql`insert into comercial.__migraciones (hash, created_at) values (${m.hash}, ${m.folderMillis})`,
      );
      aplicadas.push(m.hash.slice(0, 12));
    }
  });

  await sembrarPermisosRol(db);
  return aplicadas;
}

export async function sembrarPermisosRol(db: Db): Promise<void> {
  const filas = ROLES.flatMap((rol) =>
    MODULOS.map((modulo) => ({ rol, modulo, nivel: MATRIZ_POR_DEFECTO[rol][modulo] })),
  );
  await db.insert(permisosRol).values(filas).onConflictDoNothing();
}

/** Crea las particiones mensuales de `mensajes` desde el mes de `desde`. */
export async function asegurarParticionesMensajes(db: Db, desde: Date, meses = 3): Promise<number> {
  const r = await db.execute<{ creadas: number }>(
    sql`select comercial.asegurar_particiones_mensajes(${desde.toISOString().slice(0, 10)}::date, ${meses}) as creadas`,
  );
  return Number(r.rows[0]?.creadas ?? 0);
}
