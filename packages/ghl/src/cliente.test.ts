import { describe, expect, it } from 'vitest';
import { ClienteGhl, ErrorGhl, type RegistroLlamada } from './cliente';
import { Limitador } from './limitador';
import { crearGhlSimulado } from './simulado';
import type { MensajeGhl } from './tipos';

const LOC = 'LOC_SIM';
const sinEspera = async () => {};

function cliente(
  datos: Parameters<typeof crearGhlSimulado>[0],
  extra: Partial<ConstructorParameters<typeof ClienteGhl>[0]> = {},
) {
  const sim = crearGhlSimulado({ token: 'token-de-prueba', ...datos });
  const registros: RegistroLlamada[] = [];
  const c = new ClienteGhl({
    token: 'token-de-prueba',
    locationId: LOC,
    fetch: sim.fetch,
    limitador: new Limitador(1000, 10_000, sinEspera),
    esperar: sinEspera,
    alRegistrar: (r) => registros.push(r),
    ...extra,
  });
  return { c, sim, registros };
}

const msg = (i: number, extra: Partial<MensajeGhl> = {}): MensajeGhl => ({
  id: `m${i}`,
  locationId: LOC,
  conversationId: `c${i % 3}`,
  contactId: `k${i % 3}`,
  dateAdded: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString(),
  direction: i % 2 ? 'outbound' : 'inbound',
  messageType: 'TYPE_WHATSAPP',
  ...extra,
});

async function todos<T>(gen: AsyncGenerator<T[]>): Promise<T[]> {
  const r: T[] = [];
  for await (const lote of gen) r.push(...lote);
  return r;
}

describe('ClienteGhl', () => {
  it('envía el header Version correcto y un User-Agent propio', async () => {
    const { c, sim } = cliente({ locationId: LOC });
    await c.usuarios();
    await todos(c.conversaciones());
    expect(sim.llamadas.map((l) => l.ruta)).toEqual(['/users/', '/conversations/search']);
  });

  it('pagina la exportación de mensajes hasta el final, en el rango pedido', async () => {
    const mensajes = Array.from({ length: 1234 }, (_, i) => msg(i));
    const { c } = cliente({ locationId: LOC, mensajes });
    const r = await todos(
      c.exportarMensajes({ desde: new Date(0), hasta: new Date('2030-01-01'), porPagina: 500 }),
    );
    expect(r).toHaveLength(1234);
    expect(new Set(r.map((m) => m.id)).size).toBe(1234);
  });

  it('reintenta una exportación que llega vacía con mensajes pendientes, y si persiste falla', async () => {
    const mensajes = Array.from({ length: 30 }, (_, i) => msg(i));
    const { c } = cliente({ locationId: LOC, mensajes, exportacionesVacias: 2 });
    expect(
      await todos(c.exportarMensajes({ desde: new Date(0), hasta: new Date('2030-01-01') })),
    ).toHaveLength(30);
    const otro = cliente({ locationId: LOC, mensajes, exportacionesVacias: 99 });
    await expect(
      todos(otro.c.exportarMensajes({ desde: new Date(0), hasta: new Date('2030-01-01') })),
    ).rejects.toThrow(/vacía/);
  });

  it('la exportación no incluye actividades; los mensajes de conversación sí', async () => {
    const mensajes = [
      msg(1),
      msg(2, { messageType: 'TYPE_ACTIVITY_OPPORTUNITY', conversationId: 'c1' }),
    ];
    const { c } = cliente({ locationId: LOC, mensajes });
    expect(
      await todos(c.exportarMensajes({ desde: new Date(0), hasta: new Date('2030-01-01') })),
    ).toHaveLength(1);
    const act = await todos(c.mensajesConversacion('c1', 'TYPE_ACTIVITY_OPPORTUNITY'));
    expect(act.map((m) => m.id)).toEqual(['m2']);
  });

  it('pagina mensajes de una conversación por lastMessageId', async () => {
    const mensajes = Array.from({ length: 250 }, (_, i) => msg(i, { conversationId: 'cx' }));
    const { c } = cliente({ locationId: LOC, mensajes });
    expect(await todos(c.mensajesConversacion('cx'))).toHaveLength(250);
  });

  it('pagina conversaciones y se detiene en la marca de agua', async () => {
    const conversaciones = Array.from({ length: 230 }, (_, i) => ({
      id: `c${i}`,
      contactId: `k${i}`,
      locationId: LOC,
      lastMessageDate: 1_000_000 + i * 1000,
    }));
    const { c } = cliente({ locationId: LOC, conversaciones });
    expect(await todos(c.conversaciones())).toHaveLength(230);
    const recientes = await todos(c.conversaciones({ desde: new Date(1_000_000 + 200 * 1000) }));
    expect(recientes).toHaveLength(30);
  });

  it('pagina oportunidades con startAfter/startAfterId', async () => {
    const oportunidades = Array.from({ length: 205 }, (_, i) => ({
      id: `o${String(i).padStart(3, '0')}`,
      status: 'open' as const,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
      contactId: `k${i % 7}`,
    }));
    const { c } = cliente({ locationId: LOC, oportunidades });
    expect(await todos(c.oportunidades())).toHaveLength(205);
    expect(
      (await todos(c.oportunidades({ contactId: 'k3' }))).every((o) => o.contactId === 'k3'),
    ).toBe(true);
  });

  it('distingue mensajes del agente de IA', async () => {
    const { c } = cliente({ locationId: LOC, generadosPorIa: new Set(['m1']) });
    expect(await c.generacionIa('m1')).toBe('ia');
    expect(await c.generacionIa('m2')).toBe('sin_ia');
  });

  it('una falla de red o de permisos en generations no se toma como humano', async () => {
    const { c } = cliente({ locationId: LOC, permisosFaltantes: ['conversation-ai.readonly'] });
    expect(await c.generacionIa('m1')).toBe('error');
  });

  it('reintenta 429 y 5xx y luego responde', async () => {
    const { c, registros } = cliente({
      locationId: LOC,
      usuarios: [{ id: 'u1' }],
      fallas: [
        { ruta: '/users/', estado: 429, veces: 2 },
        { ruta: '/users/', estado: 502, veces: 1 },
      ],
    });
    expect(await c.usuarios()).toHaveLength(1);
    expect(registros.map((r) => r.estado)).toEqual([429, 429, 502, 200]);
  });

  it('se rinde tras el máximo de reintentos', async () => {
    const { c } = cliente(
      { locationId: LOC, fallas: [{ ruta: '/users/', estado: 503, veces: 99 }] },
      { reintentosMax: 2 },
    );
    await expect(c.usuarios()).rejects.toBeInstanceOf(ErrorGhl);
  });

  it('no reintenta errores 4xx', async () => {
    const { c, registros } = cliente({ locationId: LOC, token: 'otro' });
    await expect(c.usuarios()).rejects.toMatchObject({ estado: 401 });
    expect(registros).toHaveLength(1);
  });

  it('el registro de llamadas nunca incluye el token', async () => {
    const { c, registros } = cliente({ locationId: LOC });
    await c.usuarios();
    expect(JSON.stringify(registros)).not.toContain('token-de-prueba');
  });

  it('verifica permisos y dice cuál falta', async () => {
    const { c } = cliente({
      locationId: LOC,
      permisosFaltantes: ['opportunities.readonly', 'conversation-ai.readonly'],
    });
    const r = await c.verificarPermisos();
    expect(r['opportunities.readonly'].ok).toBe(false);
    expect(r['conversation-ai.readonly'].ok).toBe(false);
    expect(r['users.readonly'].ok).toBe(true);
    expect(r['conversations/message.readonly'].ok).toBe(true);
  });
});

describe('Limitador', () => {
  it('no supera el máximo por ventana', async () => {
    let t = 0;
    const esperas: number[] = [];
    const l = new Limitador(
      3,
      10_000,
      async (ms) => {
        esperas.push(ms);
        t += ms;
      },
      () => t,
    );
    for (let i = 0; i < 7; i++) await l.turno();
    expect(esperas.length).toBe(2);
    expect(t).toBeGreaterThanOrEqual(20_000);
  });

  it('pausa cuando GHL avisa que quedan pocas llamadas', async () => {
    let t = 0;
    const l = new Limitador(
      100,
      10_000,
      async (ms) => {
        t += ms;
      },
      () => t,
    );
    l.actualizar(
      new Headers({ 'x-ratelimit-remaining': '2', 'x-ratelimit-interval-milliseconds': '10000' }),
    );
    await l.turno();
    expect(t).toBe(10_000);
  });
});
