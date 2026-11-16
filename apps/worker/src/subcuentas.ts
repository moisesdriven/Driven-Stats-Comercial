import { and, eq } from 'drizzle-orm';
import { descifrar, tablas, type Db } from '@driven/db';
import { ClienteGhl, limitadorDe, type RegistroLlamada } from '@driven/ghl';
import { log } from './sync/util';

export interface SubcuentaActiva {
  locationId: string;
  nombre: string;
  cliente: ClienteGhl;
}

/** Subcuentas activas con un PIT cargado, cada una con su cliente de GHL (token descifrado en memoria). */
export async function subcuentasActivas(
  db: Db,
  maxPorVentana: number,
  soloLocation?: string,
): Promise<SubcuentaActiva[]> {
  const filas = await db
    .select({
      locationId: tablas.subcuentas.locationId,
      nombre: tablas.subcuentas.nombre,
      token: tablas.credenciales.tokenCifrado,
    })
    .from(tablas.subcuentas)
    .innerJoin(
      tablas.credenciales,
      and(
        eq(tablas.credenciales.locationId, tablas.subcuentas.locationId),
        eq(tablas.credenciales.tipo, 'subcuenta'),
      ),
    )
    .where(eq(tablas.subcuentas.activa, true));
  return filas
    .filter((f) => !soloLocation || f.locationId === soloLocation)
    .map((f) => ({
      locationId: f.locationId,
      nombre: f.nombre,
      cliente: new ClienteGhl({
        token: descifrar(f.token),
        locationId: f.locationId,
        limitador: limitadorDe(f.locationId, maxPorVentana),
        alRegistrar: registrarLlamada,
      }),
    }));
}

/** Registro de llamadas a GHL para auditoría: solo errores y reintentos (sin token). */
function registrarLlamada(r: RegistroLlamada) {
  // Un 400 de generations significa "no lo generó la IA" (respuesta normal): no se registra.
  const normal = r.estado === 400 && r.ruta === '/conversation-ai/generations';
  if (!normal && (r.estado === 'red' || r.estado >= 400 || r.intento > 0))
    log('ghl_llamada', { ...r });
}
