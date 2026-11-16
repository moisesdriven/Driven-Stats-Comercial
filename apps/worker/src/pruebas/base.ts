/** Base desechable para las pruebas del worker (<DATABASE_URL_TEST>_worker): nunca una base real. */
import pg from 'pg';
import { crearConexion, type Db } from '@driven/db';
import { migrar } from '@driven/db/migrar';

export const URL_PRUEBAS = process.env.DATABASE_URL_TEST;

export async function baseWorker(): Promise<Db> {
  const urlBase = new globalThis.URL(URL_PRUEBAS!);
  const nombre = `${urlBase.pathname.slice(1)}_worker`;
  const admin = new pg.Client({ connectionString: URL_PRUEBAS });
  await admin.connect();
  const existe = await admin.query('select 1 from pg_database where datname = $1', [nombre]);
  if (!existe.rowCount) await admin.query(`create database "${nombre}"`);
  await admin.end();
  urlBase.pathname = `/${nombre}`;
  const c = new pg.Client({ connectionString: urlBase.toString() });
  await c.connect();
  await c.query('drop schema if exists comercial cascade; create schema comercial;');
  await c.end();
  const { db } = crearConexion(urlBase.toString(), 4);
  await migrar(db);
  return db;
}
