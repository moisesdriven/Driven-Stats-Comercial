/**
 * Cliente de SOLO LECTURA de la API v2 de GHL (ESPECIFICACION.md §7).
 * - Header `Version` por grupo de endpoints, verificado en la documentación oficial.
 * - Límite de ráfaga por subcuenta, reintentos de 429/5xx/red con backoff exponencial y jitter.
 * - Paginación hasta el final.
 * - Registro de cada llamada SIN token (método, ruta, estado, duración).
 * - `User-Agent` propio: Cloudflare bloquea a GHL los clientes genéricos (error 1010).
 * Única llamada POST: búsquedas (oportunidades, contactos y tareas), que no modifican nada.
 */
import type { ResultadoGeneracionIa } from '@driven/core';
import { esperarReal, limitadorDe, type Esperar, type Limitador } from './limitador';
import type {
  ConversacionGhl,
  MensajeGhl,
  MotivoPerdidaGhl,
  OportunidadGhl,
  PipelineGhl,
  SubcuentaGhl,
  TareaGhl,
  UsuarioGhl,
} from './tipos';

export const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
export const VERSION_CONVERSACIONES = '2021-04-15';
/** Consultas extra para confirmar que un rango de la exportación de mensajes está realmente vacío. */
export const CONFIRMACIONES_RANGO_VACIO = 2;
export const VERSION_GENERAL = '2021-07-28';
export const USER_AGENT = 'driven-comercial/1.0';

export interface RegistroLlamada {
  metodo: string;
  ruta: string;
  estado: number | 'red';
  ms: number;
  intento: number;
  locationId: string;
}

export interface OpcionesCliente {
  token: string;
  locationId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  limitador?: Limitador;
  esperar?: Esperar;
  reintentosMax?: number;
  timeoutMs?: number;
  alRegistrar?: (r: RegistroLlamada) => void;
}

export class ErrorGhl extends Error {
  constructor(
    public readonly estado: number,
    public readonly ruta: string,
    public readonly cuerpo: string,
  ) {
    super(`GHL respondió ${estado} en ${ruta}: ${cuerpo.slice(0, 200)}`);
  }
}

interface Solicitud {
  version: string;
  query?: Record<string, string | number | boolean | undefined>;
  cuerpo?: unknown;
}

export class ClienteGhl {
  readonly locationId: string;
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;
  private readonly limitador: Limitador;
  private readonly esperar: Esperar;
  private readonly reintentosMax: number;
  private readonly timeoutMs: number;
  private readonly alRegistrar: ((r: RegistroLlamada) => void) | undefined;
  /** Cantidad de llamadas hechas por esta instancia (para el resumen de cada carga). */
  llamadas = 0;

  constructor(o: OpcionesCliente) {
    if (!o.token) throw new Error('Falta el token de GHL.');
    this.token = o.token;
    this.locationId = o.locationId;
    this.baseUrl = o.baseUrl ?? GHL_BASE_URL;
    this.fetchFn = o.fetch ?? fetch;
    this.limitador = o.limitador ?? limitadorDe(o.locationId);
    this.esperar = o.esperar ?? esperarReal;
    this.reintentosMax = o.reintentosMax ?? 5;
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.alRegistrar = o.alRegistrar;
  }

  /** Llamada genérica con límite, reintentos y registro. Devuelve el JSON. */
  async solicitar<T>(metodo: 'GET' | 'POST', ruta: string, s: Solicitud): Promise<T> {
    const url = new URL(ruta, this.baseUrl);
    for (const [k, v] of Object.entries(s.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    let ultimoError: unknown;
    for (let intento = 0; intento <= this.reintentosMax; intento++) {
      await this.limitador.turno();
      const inicio = Date.now();
      let respuesta: Response;
      try {
        respuesta = await this.fetchFn(url, {
          method: metodo,
          headers: {
            Authorization: `Bearer ${this.token}`,
            Version: s.version,
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
            ...(s.cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
          },
          ...(s.cuerpo !== undefined ? { body: JSON.stringify(s.cuerpo) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (e) {
        this.llamadas++;
        this.registrar(metodo, url.pathname, 'red', inicio, intento);
        ultimoError = e;
        await this.esperar(this.retraso(intento));
        continue;
      }
      this.llamadas++;
      this.registrar(metodo, url.pathname, respuesta.status, inicio, intento);
      this.limitador.actualizar(respuesta.headers);

      if (respuesta.ok) return (await respuesta.json()) as T;
      const cuerpo = await respuesta.text();
      if (respuesta.status === 429 || respuesta.status >= 500) {
        const retryAfter = Number(respuesta.headers.get('retry-after'));
        const ms =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : this.retraso(intento);
        if (respuesta.status === 429) this.limitador.pausar(ms);
        ultimoError = new ErrorGhl(respuesta.status, url.pathname, cuerpo);
        await this.esperar(ms);
        continue;
      }
      throw new ErrorGhl(respuesta.status, url.pathname, cuerpo);
    }
    throw ultimoError instanceof Error ? ultimoError : new Error('GHL no respondió.');
  }

  /** Backoff exponencial con jitter: 1 s, 2 s, 4 s… (máx. 30 s) ± 30 %. */
  private retraso(intento: number): number {
    const base = Math.min(30_000, 1000 * 2 ** intento);
    return Math.round(base * (0.7 + Math.random() * 0.6));
  }

  private registrar(
    metodo: string,
    ruta: string,
    estado: number | 'red',
    inicio: number,
    intento: number,
  ) {
    this.alRegistrar?.({
      metodo,
      ruta,
      estado,
      ms: Date.now() - inicio,
      intento,
      locationId: this.locationId,
    });
  }

  // ------------------------------------------------------------------ Subcuenta, usuarios, pipelines

  async subcuenta(): Promise<SubcuentaGhl> {
    const r = await this.solicitar<{ location: SubcuentaGhl }>(
      'GET',
      `/locations/${this.locationId}`,
      {
        version: VERSION_GENERAL,
      },
    );
    return r.location;
  }

  async usuarios(): Promise<UsuarioGhl[]> {
    const r = await this.solicitar<{ users: UsuarioGhl[] }>('GET', '/users/', {
      version: VERSION_GENERAL,
      query: { locationId: this.locationId },
    });
    return r.users ?? [];
  }

  async pipelines(): Promise<PipelineGhl[]> {
    const r = await this.solicitar<{ pipelines: PipelineGhl[] }>(
      'GET',
      '/opportunities/pipelines',
      {
        version: VERSION_GENERAL,
        query: { locationId: this.locationId },
      },
    );
    return r.pipelines ?? [];
  }

  async motivosPerdida(): Promise<MotivoPerdidaGhl[]> {
    const todos: MotivoPerdidaGhl[] = [];
    for (let skip = 0; ; skip += 100) {
      const r = await this.solicitar<{ lostReasons?: MotivoPerdidaGhl[] }>(
        'GET',
        '/opportunities/lost-reason',
        {
          version: VERSION_GENERAL,
          query: { locationId: this.locationId, skip, limit: 100 },
        },
      );
      const lote = r.lostReasons ?? [];
      todos.push(...lote);
      if (lote.length < 100) return todos;
    }
  }

  // ------------------------------------------------------------------ Mensajes y conversaciones

  /** Todos los mensajes de la subcuenta en un rango (exportación con cursor, 10 a 500 por página). */
  async *exportarMensajes(p: {
    desde: Date;
    hasta: Date;
    porPagina?: number;
    /** Recibe el `total` que informa GHL para el rango (para validar la carga). */
    alTotal?: (total: number) => void;
  }): AsyncGenerator<MensajeGhl[]> {
    let cursor: string | undefined;
    let entregados = 0;
    let vaciosSeguidos = 0;
    let confirmacionesVacio = 0;
    for (;;) {
      const r = await this.solicitar<{
        messages?: MensajeGhl[];
        nextCursor?: string;
        total?: number;
      }>('GET', '/conversations/messages/export', {
        version: VERSION_CONVERSACIONES,
        query: {
          locationId: this.locationId,
          limit: p.porPagina ?? 500,
          sortBy: 'createdAt',
          sortOrder: 'asc',
          startDate: p.desde.toISOString(),
          endDate: p.hasta.toISOString(),
          cursor,
        },
      });
      const lote = r.messages ?? [];
      // Defensa: GHL a veces responde `total: 0` y ninguna página para un rango que sí tiene
      // mensajes (visto en Jade18K el 16 nov 2026). Un rango vacío se confirma con más consultas
      // antes de aceptarlo; si no, la marca de avance saltaría esos mensajes para siempre.
      if (!cursor && !lote.length && !r.total && confirmacionesVacio < CONFIRMACIONES_RANGO_VACIO) {
        await this.esperar(3000 * ++confirmacionesVacio);
        continue;
      }
      if (r.total !== undefined && !cursor) p.alTotal?.(r.total);
      // Defensa: GHL a veces responde una página vacía aunque `total` indique que faltan mensajes.
      // Se reintenta con espera; si persiste, se falla de forma visible en vez de perder datos.
      if (!lote.length && (r.total ?? 0) > entregados) {
        if (++vaciosSeguidos > 3) {
          throw new Error(
            `La exportación de GHL respondió vacía con ${r.total} mensajes pendientes (${p.desde.toISOString()} a ${p.hasta.toISOString()}).`,
          );
        }
        await this.esperar(5000 * vaciosSeguidos);
        continue;
      }
      vaciosSeguidos = 0;
      entregados += lote.length;
      if (!lote.length) return;
      yield lote;
      if (!r.nextCursor) return;
      cursor = r.nextCursor;
    }
  }

  /** Mensajes de una conversación (incluye actividades). Paginación por `lastMessageId`. */
  async *mensajesConversacion(conversationId: string, tipo?: string): AsyncGenerator<MensajeGhl[]> {
    let lastMessageId: string | undefined;
    for (;;) {
      const r = await this.solicitar<{
        messages?: { lastMessageId?: string; nextPage?: boolean; messages?: MensajeGhl[] };
      }>('GET', `/conversations/${conversationId}/messages`, {
        version: VERSION_CONVERSACIONES,
        query: { limit: 100, lastMessageId, type: tipo },
      });
      const lote = r.messages?.messages ?? [];
      if (lote.length) yield lote;
      if (!r.messages?.nextPage || !r.messages.lastMessageId || !lote.length) return;
      lastMessageId = r.messages.lastMessageId;
    }
  }

  /**
   * Conversaciones ordenadas por último mensaje (más reciente primero), hasta las que tuvieron
   * actividad antes de `desde`. Paginación por `startAfterDate` (= `sort` del último elemento).
   */
  async *conversaciones(p: { desde?: Date } = {}): AsyncGenerator<ConversacionGhl[]> {
    let startAfterDate: number | undefined;
    for (;;) {
      const r = await this.solicitar<{ conversations?: ConversacionGhl[] }>(
        'GET',
        '/conversations/search',
        {
          version: VERSION_CONVERSACIONES,
          query: {
            locationId: this.locationId,
            limit: 100,
            sortBy: 'last_message_date',
            sort: 'desc',
            startAfterDate,
          },
        },
      );
      const lote = r.conversations ?? [];
      const limite = p.desde?.getTime();
      const dentro = limite ? lote.filter((c) => (c.lastMessageDate ?? 0) >= limite) : lote;
      if (dentro.length) yield dentro;
      if (lote.length < 100 || dentro.length < lote.length) return;
      const ultimo = lote[lote.length - 1]!;
      startAfterDate = ultimo.sort?.[0] ?? ultimo.lastMessageDate;
      if (!startAfterDate) return;
    }
  }

  /** Consulta si un mensaje lo generó el agente de IA (Conversation AI). */
  async generacionIa(messageId: string): Promise<ResultadoGeneracionIa> {
    try {
      await this.solicitar('GET', '/conversation-ai/generations', {
        version: VERSION_CONVERSACIONES,
        query: { messageId, source: 'conversation' },
      });
      return 'ia';
    } catch (e) {
      if (e instanceof ErrorGhl && e.estado === 400 && /No Ai suggestion/i.test(e.cuerpo))
        return 'sin_ia';
      return 'error';
    }
  }

  // ------------------------------------------------------------------ Oportunidades y tareas

  /** Oportunidades de la subcuenta (o de un contacto). Paginación `startAfter` + `startAfterId`. */
  async *oportunidades(p: { contactId?: string } = {}): AsyncGenerator<OportunidadGhl[]> {
    let startAfter: number | undefined;
    let startAfterId: string | undefined;
    for (;;) {
      const r = await this.solicitar<{
        opportunities?: OportunidadGhl[];
        meta?: { startAfter?: number; startAfterId?: string };
      }>('GET', '/opportunities/search', {
        version: VERSION_GENERAL,
        query: {
          location_id: this.locationId,
          contact_id: p.contactId,
          status: 'all',
          limit: 100,
          startAfter,
          startAfterId,
        },
      });
      const lote = r.opportunities ?? [];
      if (lote.length) yield lote;
      if (lote.length < 100 || !r.meta?.startAfterId) return;
      startAfter = r.meta.startAfter;
      startAfterId = r.meta.startAfterId;
    }
  }

  async *tareas(): AsyncGenerator<TareaGhl[]> {
    for (let skip = 0; ; skip += 100) {
      const r = await this.solicitar<{ tasks?: TareaGhl[] }>(
        'POST',
        `/locations/${this.locationId}/tasks/search`,
        {
          version: VERSION_GENERAL,
          cuerpo: { limit: 100, skip },
        },
      );
      const lote = r.tasks ?? [];
      if (lote.length) yield lote;
      if (lote.length < 100) return;
    }
  }

  // ------------------------------------------------------------------ Verificación de permisos

  /**
   * Prueba cada permiso que necesita el sistema con una llamada mínima (§7) y devuelve cuál falta.
   * `conversation-ai.readonly` es necesario para separar al agente de IA (docs/mapeo-origen.md).
   */
  async verificarPermisos(): Promise<Record<PermisoGhl, { ok: boolean; detalle?: string }>> {
    const pruebas: Record<PermisoGhl, () => Promise<unknown>> = {
      'locations.readonly': () => this.subcuenta(),
      'users.readonly': () => this.usuarios(),
      'conversations.readonly': () =>
        this.solicitar('GET', '/conversations/search', {
          version: VERSION_CONVERSACIONES,
          query: { locationId: this.locationId, limit: 1 },
        }),
      'conversations/message.readonly': () =>
        this.solicitar('GET', '/conversations/messages/export', {
          version: VERSION_CONVERSACIONES,
          query: { locationId: this.locationId, limit: 10 },
        }),
      'opportunities.readonly': () =>
        this.solicitar('GET', '/opportunities/search', {
          version: VERSION_GENERAL,
          query: { location_id: this.locationId, limit: 1 },
        }),
      'contacts.readonly': () =>
        this.solicitar('POST', '/contacts/search', {
          version: VERSION_GENERAL,
          cuerpo: { locationId: this.locationId, pageLimit: 1 },
        }),
      'conversation-ai.readonly': async () => {
        try {
          await this.solicitar('GET', '/conversation-ai/generations', {
            version: VERSION_CONVERSACIONES,
            query: { messageId: 'verificacion-permiso', source: 'conversation' },
          });
        } catch (e) {
          // 400/404 = el permiso existe pero el mensaje de prueba no; 401/403 = falta el permiso.
          if (e instanceof ErrorGhl && (e.estado === 400 || e.estado === 404 || e.estado === 422))
            return;
          throw e;
        }
      },
    };
    const resultado = {} as Record<PermisoGhl, { ok: boolean; detalle?: string }>;
    for (const [permiso, prueba] of Object.entries(pruebas) as [
      PermisoGhl,
      () => Promise<unknown>,
    ][]) {
      try {
        await prueba();
        resultado[permiso] = { ok: true };
      } catch (e) {
        resultado[permiso] = {
          ok: false,
          detalle: e instanceof ErrorGhl ? `GHL respondió ${e.estado}` : 'Sin respuesta de GHL',
        };
      }
    }
    return resultado;
  }
}

export const PERMISOS_GHL = [
  'locations.readonly',
  'users.readonly',
  'conversations.readonly',
  'conversations/message.readonly',
  'opportunities.readonly',
  'contacts.readonly',
  'conversation-ai.readonly',
] as const;
export type PermisoGhl = (typeof PERMISOS_GHL)[number];
