/** Base desechable para la prueba de punta a punta: esquema nuevo, dos subcuentas y un usuario por rol. */
import { acumuladoVacio } from '@driven/core';
import { tablas } from '@driven/db';
import { cerrarDb } from '../src/servidor/db';
import { crearUsuarioPrueba, prepararBase } from '../src/pruebas/entorno';

export default async function preparar() {
  if (!process.env.DATABASE_URL_TEST)
    throw new Error('La prueba de punta a punta necesita DATABASE_URL_TEST.');
  const db = await prepararBase();
  await db.insert(tablas.subcuentas).values([
    { locationId: 'LOC_A', nombre: 'Tienda Norte' },
    { locationId: 'LOC_B', nombre: 'Tienda Sur' },
  ]);
  await db.insert(tablas.asesores).values([
    { userId: 'U1', nombre: 'Rosa Quispe' },
    { userId: 'U2', nombre: 'Luis Mamani' },
  ]);
  await db.insert(tablas.asesorSubcuenta).values([
    { userId: 'U1', locationId: 'LOC_A' },
    { userId: 'U2', locationId: 'LOC_A' },
  ]);
  const hoy = new Date().toISOString().slice(0, 10);
  const dia = {
    ...acumuladoVacio(),
    leadsRecibidos: 12,
    tiemposRespuesta: [3, 4, 9],
    ventas: 2,
    montoVentas: 900,
  };
  await db.insert(tablas.resumenDiario).values([
    { fecha: hoy, locationId: 'LOC_A', asesorId: null, indicadores: dia },
    { fecha: hoy, locationId: 'LOC_A', asesorId: 'U1', indicadores: dia },
    { fecha: hoy, locationId: 'LOC_B', asesorId: null, indicadores: dia },
  ]);
  await crearUsuarioPrueba(db, { correo: 'admin@e2e.pe', rol: 'admin' });
  await crearUsuarioPrueba(db, { correo: 'dueno@e2e.pe', rol: 'dueno', subcuentas: ['LOC_A'] });
  await crearUsuarioPrueba(db, {
    correo: 'asesor@e2e.pe',
    rol: 'asesor',
    subcuentas: ['LOC_A'],
    userIdGhl: 'U1',
  });
  await cerrarDb();
}
