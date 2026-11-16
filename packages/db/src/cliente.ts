import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as esquema from './esquema/index';

export type Db = NodePgDatabase<typeof esquema>;

export interface ConexionDb {
  db: Db;
  pool: pg.Pool;
}

/** Crea un pool y su cliente Drizzle. Cada proceso usa la URL de su propio rol. */
export function crearConexion(url: string, max = 10): ConexionDb {
  if (!url) throw new Error('Falta la URL de conexión a PostgreSQL.');
  const pool = new pg.Pool({ connectionString: url, max, application_name: 'driven-comercial' });
  return { db: drizzle(pool, { schema: esquema }), pool };
}
