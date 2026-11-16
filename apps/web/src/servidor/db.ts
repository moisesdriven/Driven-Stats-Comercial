import { crearConexion, type ConexionDb, type Db } from '@driven/db';

const global = globalThis as unknown as { __conexionComercial?: ConexionDb };

/** Conexión única por proceso, con el rol de la web (DATABASE_URL). */
export function obtenerDb(): Db {
  if (!global.__conexionComercial) {
    global.__conexionComercial = crearConexion(process.env.DATABASE_URL ?? '');
  }
  return global.__conexionComercial.db;
}

/** Solo para pruebas: cierra y olvida la conexión. */
export async function cerrarDb(): Promise<void> {
  await global.__conexionComercial?.pool.end();
  delete global.__conexionComercial;
}
