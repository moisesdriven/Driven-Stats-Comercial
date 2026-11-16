/**
 * Aplica las migraciones del esquema `comercial` con el rol migrador (DATABASE_URL_MIGRADOR).
 * Lo ejecuta scripts/deploy/03-desplegar.ps1 antes de levantar los servicios:
 *   docker compose run --rm worker node dist/migrar.js
 */
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crearConexion } from '@driven/db';
import { asegurarParticionesMensajes, migrar } from '@driven/db/migrar';

const carpeta =
  process.env.CARPETA_MIGRACIONES ??
  resolve(dirname(fileURLToPath(import.meta.url)), '..', 'migraciones');
const { db, pool } = crearConexion(process.env.DATABASE_URL_MIGRADOR ?? '', 1);
try {
  const aplicadas = await migrar(db, carpeta);
  console.log(
    aplicadas.length
      ? `[migrar] Migraciones aplicadas: ${aplicadas.join(', ')}`
      : '[migrar] La base ya estaba al día.',
  );
  const particiones = await asegurarParticionesMensajes(db, new Date(), 3);
  console.log(`[migrar] Particiones de mensajes nuevas: ${particiones}`);
} catch (e) {
  console.error('[migrar] Error:', e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
