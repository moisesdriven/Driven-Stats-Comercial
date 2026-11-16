/**
 * Crea el primer administrador (o uno adicional).
 * Uso dentro del contenedor web:
 *   node apps/web/cli/crear-admin.mjs --correo admin@empresa.com --nombre "Nombre Apellido"
 * Muestra una contraseña temporal UNA sola vez; debe cambiarse al primer ingreso.
 */
import { crearConexion } from '@driven/db';
import { crearAdministrador } from '../servidor/crear-admin';

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const correo = argumento('correo');
const nombre = argumento('nombre');
if (!correo || !nombre) {
  console.error('Uso: crear-admin --correo <correo> --nombre "<nombre>"');
  process.exit(2);
}

const { db, pool } = crearConexion(process.env.DATABASE_URL ?? '', 1);
try {
  const { claveTemporal } = await crearAdministrador(db, { correo, nombre });
  console.log('');
  console.log('Administrador creado.');
  console.log(`  Correo:               ${correo.trim().toLowerCase()}`);
  console.log(`  Contraseña temporal:  ${claveTemporal}`);
  console.log('');
  console.log('Guárdala ahora: no se volverá a mostrar. Se pedirá cambiarla en el primer ingreso.');
} catch (e) {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
