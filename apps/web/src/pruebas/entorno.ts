/**
 * Entorno de pruebas de integración: PostgreSQL desechable (DATABASE_URL_TEST) y nunca tokens reales.
 * Recrea el esquema `comercial` desde cero y aplica las migraciones.
 */
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { crearConexion, tablas, type Db } from '@driven/db';
import { migrar } from '@driven/db/migrar';
import type { Rol } from '@driven/core';
import { hashearClave } from '@/servidor/claves';
import { cerrarDb } from '@/servidor/db';

export const URL_PRUEBAS = process.env.DATABASE_URL_TEST;
export const hayBaseDePruebas = Boolean(URL_PRUEBAS);

export async function prepararBase(): Promise<Db> {
  if (!URL_PRUEBAS) throw new Error('Falta DATABASE_URL_TEST.');
  if (/comercial_web|comercial_worker|comercial_migrador/.test(URL_PRUEBAS)) {
    throw new Error('DATABASE_URL_TEST no debe apuntar a la base real.');
  }
  const admin = new pg.Client({ connectionString: URL_PRUEBAS });
  await admin.connect();
  await admin.query('drop schema if exists comercial cascade; create schema comercial;');
  await admin.end();

  process.env.DATABASE_URL = URL_PRUEBAS;
  process.env.CLAVE_CIFRADO ??= randomBytes(32).toString('base64');
  await cerrarDb();

  const { db, pool } = crearConexion(URL_PRUEBAS, 2);
  await migrar(db);
  await pool.end();
  const { obtenerDb } = await import('@/servidor/db');
  return obtenerDb();
}

export const CLAVE_PRUEBA = 'ClaveDePrueba123';

export async function crearUsuarioPrueba(
  db: Db,
  datos: {
    correo: string;
    rol: Rol;
    subcuentas?: string[];
    userIdGhl?: string;
    debeCambiarClave?: boolean;
  },
): Promise<string> {
  const [u] = await db
    .insert(tablas.usuarios)
    .values({
      correo: datos.correo,
      nombre: datos.correo.split('@')[0]!,
      rol: datos.rol,
      hash: await hashearClave(CLAVE_PRUEBA),
      debeCambiarClave: datos.debeCambiarClave ?? false,
    })
    .returning({ id: tablas.usuarios.id });
  for (const locationId of datos.subcuentas ?? []) {
    await db.insert(tablas.usuarioSubcuenta).values({ usuarioId: u!.id, locationId });
  }
  if (datos.userIdGhl) {
    await db.insert(tablas.usuarioAsesor).values({ usuarioId: u!.id, userId: datos.userIdGhl });
  }
  return u!.id;
}

type Handler = (
  req: Request,
  ctx: { params: Promise<Record<string, string>> },
) => Promise<Response>;

export interface Llamada {
  metodo?: string;
  cookie?: string | undefined;
  cuerpo?: unknown;
  params?: Record<string, string>;
  origen?: string;
}

/** Llama a un handler de ruta de Next como lo haría el servidor. */
export async function llamar(handler: unknown, ruta: string, opciones: Llamada = {}) {
  const headers = new Headers({ host: 'localhost:3100' });
  if (opciones.cookie) headers.set('cookie', opciones.cookie);
  if (opciones.cuerpo !== undefined) headers.set('content-type', 'application/json');
  if (opciones.origen) headers.set('origin', opciones.origen);
  const req = new Request(`http://localhost:3100${ruta}`, {
    method: opciones.metodo ?? (opciones.cuerpo !== undefined ? 'POST' : 'GET'),
    headers,
    ...(opciones.cuerpo !== undefined ? { body: JSON.stringify(opciones.cuerpo) } : {}),
  });
  const res = await (handler as Handler)(req, { params: Promise.resolve(opciones.params ?? {}) });
  const texto = await res.text();
  return {
    estado: res.status,
    cuerpo: (texto ? JSON.parse(texto) : null) as Record<string, unknown> & {
      codigo?: string;
      error?: string;
    },
    cookie: res.headers.get('set-cookie')?.split(';')[0],
  };
}
