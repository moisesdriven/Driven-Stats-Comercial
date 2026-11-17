/**
 * Lista en vivo "Sin responder" (reglas del 16 y 17 nov 2026) contra PostgreSQL real: falta del
 * asesor a los 15 min si está en turno, aparte si está fuera de turno (más de 3 h sin actividad),
 * sin contar el Headline. Cubre también cómo llegan las fechas desde el driver.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import { cargarContexto, type ContextoAcceso } from '@/servidor/acceso';
import { listasParaActuar } from '@/servidor/consultas/listas';
import { crearUsuarioPrueba, hayBaseDePruebas, prepararBase } from './entorno';

const LOC = 'LOC_LISTAS';
const AHORA = new Date();
const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000);

describe.skipIf(!hayBaseDePruebas)('lista en vivo "Sin responder" (integración)', () => {
  let db: Db;
  let ctx: ContextoAcceso;
  let n = 0;
  const msg = (
    contacto: string,
    fecha: Date,
    direccion: 'inbound' | 'outbound',
    origen: string | null,
    userId: string | null = null,
    texto: string | null = null,
  ) => ({
    messageId: `l${++n}`,
    locationId: LOC,
    conversationId: `c_${contacto}`,
    contactId: contacto,
    direccion,
    origen: origen as 'manual' | null,
    userId,
    texto,
    fecha,
  });

  beforeAll(async () => {
    db = await prepararBase();
    await db
      .insert(tablas.subcuentas)
      .values({ locationId: LOC, nombre: 'Listas', zonaHoraria: 'America/Lima' });
    await db.insert(tablas.asesores).values([
      { userId: 'U1', nombre: 'Asesora En Turno' },
      { userId: 'U2', nombre: 'Asesora Fuera De Turno' },
    ]);
    const inicioMes = new Date(Date.UTC(AHORA.getUTCFullYear(), AHORA.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 10);
    await db.execute(sql`select comercial.asegurar_particiones_mensajes(${inicioMes}::date, 3)`);
    await db.insert(tablas.mensajes).values([
      // Actividad de U1 hace 90 y 30 min con otro cliente (en turno); la de U2, hace 5 h (fuera de turno).
      msg('OTRO1', hace(90), 'outbound', 'manual', 'U1'),
      msg('OTRO1', hace(30), 'outbound', 'manual', 'U1'),
      msg('OTRO2', hace(300), 'outbound', 'manual', 'U2'),
      // K1 (U1): escribió hace 40 min y nadie respondió → falta.
      msg('K1', hace(40), 'inbound', null),
      // K2 (U2): escribió hace 60 min, su asesora está fuera de turno → aparte.
      msg('K2', hace(60), 'inbound', null),
      // K3 (U1): escribió hace 5 min → aún no es falta.
      msg('K3', hace(5), 'inbound', null),
      // K4 (U1): solo el Headline → no cuenta.
      msg('K4', hace(50), 'inbound', null, null, '*Headline:* Anillo *Source URL:* …'),
      // K5 (U1): el workflow respondió → no es falta.
      msg('K5', hace(45), 'inbound', null),
      msg('K5', hace(44), 'outbound', 'workflow'),
    ]);
    const lead = (contactId: string, asesorId: string) => ({
      locationId: LOC,
      contactId,
      conversationId: `c_${contactId}`,
      asesorId,
      ingresoEn: hace(120),
      estado: 'abierto',
      etapaEstandar: 'contactado',
    });
    await db
      .insert(tablas.leads)
      .values([
        lead('K1', 'U1'),
        lead('K2', 'U2'),
        lead('K3', 'U1'),
        lead('K4', 'U1'),
        lead('K5', 'U1'),
      ]);
    const admin = await crearUsuarioPrueba(db, { correo: 'admin@listas.pe', rol: 'admin' });
    ctx = (await cargarContexto(db, admin))!;
  });

  it('separa las faltas (asesor en turno, 15 min o más) de los pendientes fuera de turno', async () => {
    const r = await listasParaActuar(db, ctx, LOC, AHORA);
    expect(r.totales.sinResponder).toBe(1);
    expect(r.totales.fueraDeTurno).toBe(1);
    expect(r.sinResponder.map((f) => f.contacto)).toEqual(['Contacto ···K1', 'Contacto ···K2']);
    expect(r.sinResponder[0]!.espera).toBe('40 min');
    expect(r.sinResponder[1]!.espera).toBe('Asesor fuera de turno');
    expect(r.sinResponder[1]!.urgente).toBe(false);
  });
});
