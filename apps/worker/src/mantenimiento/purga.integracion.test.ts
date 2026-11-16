import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import type { ClienteGhl, MensajeGhl } from '@driven/ghl';
import { baseWorker, URL_PRUEBAS } from '../pruebas/base';
import { guardarMensajes } from '../sync/mensajes';
import { purgarTextos } from './purga';

const LOC = 'LOC_PURGA';
const AHORA = new Date('2026-11-16T12:00:00Z');
const hace = (dias: number) => new Date(AHORA.getTime() - dias * 86_400_000);

describe.skipIf(!URL_PRUEBAS)('purga:textos (integración)', () => {
  let db: Db;
  const texto = async (id: string) =>
    (
      await db.execute<{ texto: string | null }>(
        sql`select texto from comercial.mensajes where message_id = ${id}`,
      )
    ).rows[0]?.texto;

  beforeAll(async () => {
    db = await baseWorker();
    await db.insert(tablas.subcuentas).values({ locationId: LOC, nombre: 'Purga' });
    await db.execute(sql`select comercial.asegurar_particiones_mensajes('2026-07-01'::date, 6)`);
    const msg = (id: string, fecha: Date) => ({
      messageId: id,
      locationId: LOC,
      conversationId: 'C1',
      contactId: 'K1',
      direccion: 'outbound' as const,
      origen: 'manual' as const,
      texto: `texto de ${id}`,
      fecha,
    });
    await db
      .insert(tablas.mensajes)
      .values([msg('viejo', hace(100)), msg('limite', hace(89)), msg('nuevo', hace(1))]);
    const [a] = await db
      .insert(tablas.analisisCalidad)
      .values({
        locationId: LOC,
        tipo: 'manual',
        periodoDesde: '2026-08-01',
        periodoHasta: '2026-08-07',
        semilla: 'x',
        estado: 'terminado',
      })
      .returning({ id: tablas.analisisCalidad.id });
    await db.insert(tablas.clasificaciones).values({
      analisisId: a!.id,
      messageId: 'viejo',
      conversationId: 'C1',
      categoria: 'seguimiento',
      puntaje: 3,
      modelo: 'simulado',
      versionRubrica: 'v2',
    });
  });

  it('borra solo el texto de los mensajes con más de 90 días y conserva las clasificaciones', async () => {
    expect(await purgarTextos(db, AHORA)).toBe(1);
    expect(await texto('viejo')).toBeNull();
    expect(await texto('limite')).toBe('texto de limite');
    expect(await texto('nuevo')).toBe('texto de nuevo');
    expect(await db.select().from(tablas.clasificaciones)).toHaveLength(1);
    expect((await db.select().from(tablas.mensajes)).length).toBe(3);
  });

  it('es idempotente', async () => {
    expect(await purgarTextos(db, AHORA)).toBe(0);
  });

  it('una recarga desde GHL no devuelve el texto de un mensaje purgado ni guarda el de uno viejo', async () => {
    const cliente = { locationId: LOC, generacionIa: async () => 'error' } as unknown as ClienteGhl;
    const ghl = (id: string, dias: number): MensajeGhl => ({
      id,
      locationId: LOC,
      conversationId: 'C1',
      contactId: 'K1',
      direction: 'inbound',
      messageType: 'TYPE_WHATSAPP',
      body: `texto de ${id}`,
      dateAdded: hace(dias).toISOString(),
    });
    const r = {
      mensajes: 0,
      totalGhl: 0,
      verificadosIa: 0,
      porOrigen: {},
      contactos: new Set<string>(),
      conversaciones: new Set<string>(),
    };
    // El mensaje purgado vuelve en la exportación con su fecha original, y llega otro igual de viejo.
    const [purgado] = (
      await db.execute<{ fecha: Date }>(
        sql`select fecha from comercial.mensajes where message_id = 'viejo'`,
      )
    ).rows;
    await guardarMensajes(
      db,
      cliente,
      [
        {
          ...ghl('viejo', 100),
          direction: 'outbound',
          dateAdded: new Date(purgado!.fecha).toISOString(),
        },
        ghl('otro_viejo', 120),
        ghl('reciente', 2),
      ],
      r,
    );
    expect(await texto('viejo')).toBeNull();
    expect(await texto('otro_viejo')).toBeNull();
    expect(await texto('reciente')).toBe('texto de reciente');
  });
});
