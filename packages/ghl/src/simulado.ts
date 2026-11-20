/**
 * GHL simulado para pruebas: implementa los endpoints que usa el cliente, con la misma paginación,
 * sobre datos en memoria. Nunca usa tokens reales.
 */
import type {
  ConversacionGhl,
  MensajeGhl,
  MotivoPerdidaGhl,
  OportunidadGhl,
  PipelineGhl,
  TareaGhl,
  UsuarioGhl,
} from './tipos';

export interface DatosSimulados {
  locationId: string;
  nombre?: string;
  zonaHoraria?: string;
  usuarios?: UsuarioGhl[];
  pipelines?: PipelineGhl[];
  motivos?: MotivoPerdidaGhl[];
  mensajes?: MensajeGhl[];
  conversaciones?: ConversacionGhl[];
  oportunidades?: OportunidadGhl[];
  tareas?: TareaGhl[];
  /** messageIds generados por el agente de IA. */
  generadosPorIa?: Set<string>;
  /** Permisos que el token NO tiene (responde 401 en esas pruebas). */
  permisosFaltantes?: string[];
  /** Respuestas 429 o 500 a devolver antes de responder bien (por ruta). */
  fallas?: { ruta: string; estado: number; veces: number }[];
  /** Páginas de exportación que se responden vacías (con `total`) antes de responder bien. */
  exportacionesVacias?: number;
  /** Cuántas veces la exportación responde vacía y con `total: 0` aunque haya mensajes (falla real de GHL). */
  exportacionesEnCero?: number;
  /**
   * Mensajes que la exportación aún no entrega (atraso real de GHL, 17 nov 2026), aunque la consulta
   * por conversación sí los muestra.
   */
  ocultosEnExportacion?: Set<string>;
  /**
   * Conversaciones que la búsqueda lista pero que ya no existen (eliminadas o fusionadas): al pedir
   * sus mensajes GHL responde 400 CONVERSATIONS_CONVERSATION_NOT_FOUND (caso real, 20 nov 2026).
   */
  conversacionesInexistentes?: Set<string>;
  /** Token esperado; cualquier otro responde 401. */
  token?: string;
}

const json = (cuerpo: unknown, estado = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'content-type': 'application/json',
      'x-ratelimit-remaining': '99',
      'x-ratelimit-interval-milliseconds': '10000',
      ...extra,
    },
  });

const PERMISO_POR_RUTA: [RegExp, string][] = [
  [/^\/locations\/[^/]+$/, 'locations.readonly'],
  [/^\/users\/$/, 'users.readonly'],
  [/^\/conversations\/search$/, 'conversations.readonly'],
  [/^\/conversations\/messages\/export$/, 'conversations/message.readonly'],
  [/^\/conversations\/[^/]+\/messages$/, 'conversations/message.readonly'],
  [/^\/opportunities\//, 'opportunities.readonly'],
  [/^\/contacts\/search$/, 'contacts.readonly'],
  [/^\/conversation-ai\/generations$/, 'conversation-ai.readonly'],
];

export function crearGhlSimulado(d: DatosSimulados) {
  const llamadas: { metodo: string; ruta: string; query: Record<string, string> }[] = [];
  const fallas = (d.fallas ?? []).map((f) => ({ ...f }));

  const fetchSimulado: typeof fetch = async (entrada, init) => {
    const url = new URL(String(entrada instanceof Request ? entrada.url : entrada));
    const metodo = init?.method ?? 'GET';
    const q = Object.fromEntries(url.searchParams);
    const ruta = url.pathname;
    llamadas.push({ metodo, ruta, query: q });
    const cabeceras = new Headers(init?.headers);
    if (d.token && cabeceras.get('authorization') !== `Bearer ${d.token}`) {
      return json({ message: 'Invalid JWT' }, 401);
    }
    if (!cabeceras.get('user-agent')) return json({ error_code: 1010 }, 403);

    const falla = fallas.find((f) => f.ruta === ruta && f.veces > 0);
    if (falla) {
      falla.veces--;
      return json(
        { message: 'simulado' },
        falla.estado,
        falla.estado === 429 ? { 'retry-after': '0' } : {},
      );
    }
    const permiso = PERMISO_POR_RUTA.find(([re]) => re.test(ruta))?.[1];
    if (permiso && d.permisosFaltantes?.includes(permiso)) {
      return json({ message: 'The token is not authorized for this scope.' }, 401);
    }

    const convFantasma = /^\/conversations\/([^/]+)\/messages$/.exec(ruta)?.[1];
    if (convFantasma && d.conversacionesInexistentes?.has(convFantasma)) {
      return json(
        {
          arguments: {},
          canonicalCode: 'CONVERSATIONS_CONVERSATION_NOT_FOUND',
          error: 'Bad Request',
          message: `No conversation found with id: ${convFantasma}`,
          statusCode: 400,
        },
        400,
      );
    }
    if (ruta === `/locations/${d.locationId}`) {
      return json({
        location: {
          id: d.locationId,
          name: d.nombre ?? 'Simulada',
          timezone: d.zonaHoraria ?? 'America/Lima',
        },
      });
    }
    if (ruta === '/users/') return json({ users: d.usuarios ?? [] });
    if (ruta === '/opportunities/pipelines') return json({ pipelines: d.pipelines ?? [] });
    if (ruta === '/opportunities/lost-reason') {
      const skip = Number(q.skip ?? 0);
      const limit = Number(q.limit ?? 100);
      return json({ lostReasons: (d.motivos ?? []).slice(skip, skip + limit) });
    }
    if (ruta === '/conversations/messages/export') {
      const limit = Number(q.limit ?? 100);
      if (limit < 10) return json({ message: ['limit must not be less than 10'] }, 422);
      const desde = q.startDate ? new Date(q.startDate).getTime() : -Infinity;
      const hasta = q.endDate ? new Date(q.endDate).getTime() : Infinity;
      const todos = (d.mensajes ?? [])
        .filter((m) => !m.messageType?.startsWith('TYPE_ACTIVITY_'))
        .filter((m) => !d.ocultosEnExportacion?.has(m.id))
        .filter((m) => {
          const t = new Date(m.dateAdded).getTime();
          return t >= desde && t <= hasta;
        })
        .sort((a, b) => a.dateAdded.localeCompare(b.dateAdded));
      const inicio = q.cursor ? Number(Buffer.from(q.cursor, 'base64').toString()) : 0;
      if ((d.exportacionesEnCero ?? 0) > 0) {
        d.exportacionesEnCero!--;
        return json({ messages: [], total: 0 });
      }
      if ((d.exportacionesVacias ?? 0) > 0) {
        d.exportacionesVacias!--;
        return json({ messages: [], total: todos.length });
      }
      const lote = todos.slice(inicio, inicio + limit);
      const siguiente =
        inicio + limit < todos.length
          ? Buffer.from(String(inicio + limit)).toString('base64')
          : undefined;
      return json({ messages: lote, nextCursor: siguiente, total: todos.length });
    }
    const mConv = ruta.match(/^\/conversations\/([^/]+)\/messages$/);
    if (mConv) {
      const limit = Number(q.limit ?? 20);
      const todos = (d.mensajes ?? [])
        .filter((m) => m.conversationId === mConv[1])
        .filter((m) => !q.type || m.messageType === q.type)
        .sort((a, b) => b.dateAdded.localeCompare(a.dateAdded));
      const inicio = q.lastMessageId ? todos.findIndex((m) => m.id === q.lastMessageId) + 1 : 0;
      const lote = todos.slice(inicio, inicio + limit);
      return json({
        messages: {
          lastMessageId: lote.at(-1)?.id,
          nextPage: inicio + limit < todos.length,
          messages: lote,
        },
      });
    }
    if (ruta === '/conversations/search') {
      const limit = Number(q.limit ?? 20);
      const todas = [...(d.conversaciones ?? [])]
        .map((c) => ({ ...c, sort: [c.lastMessageDate ?? 0] }))
        .sort((a, b) => (b.lastMessageDate ?? 0) - (a.lastMessageDate ?? 0));
      const desde = q.startAfterDate ? Number(q.startAfterDate) : Infinity;
      const lote = todas.filter((c) => (c.lastMessageDate ?? 0) < desde).slice(0, limit);
      return json({ conversations: lote, total: todas.length });
    }
    if (ruta === '/conversation-ai/generations') {
      if (!q.source) return json({ message: ['source should not be empty'] }, 422);
      if (d.generadosPorIa?.has(q.messageId ?? ''))
        return json({ mode: 'auto-pilot', responseMessage: '…' });
      return json(
        {
          status: 400,
          message:
            'Error while fetching details for AI response : HttpException: No Ai suggestion Found',
        },
        400,
      );
    }
    if (ruta === '/opportunities/search') {
      const limit = Number(q.limit ?? 20);
      const todas = (d.oportunidades ?? [])
        .filter((o) => !q.contact_id || o.contactId === q.contact_id)
        .sort(
          (a, b) =>
            (a.createdAt ?? '').localeCompare(b.createdAt ?? '') || a.id.localeCompare(b.id),
        );
      const inicio = q.startAfterId ? todas.findIndex((o) => o.id === q.startAfterId) + 1 : 0;
      const lote = todas.slice(inicio, inicio + limit);
      const ultimo = lote.at(-1);
      return json({
        opportunities: lote,
        meta: {
          total: todas.length,
          ...(ultimo && inicio + limit < todas.length
            ? { startAfterId: ultimo.id, startAfter: new Date(ultimo.createdAt ?? 0).getTime() }
            : {}),
        },
      });
    }
    if (ruta === `/locations/${d.locationId}/tasks/search`) {
      const cuerpo = JSON.parse(String(init?.body ?? '{}')) as { skip?: number; limit?: number };
      const skip = cuerpo.skip ?? 0;
      return json({ tasks: (d.tareas ?? []).slice(skip, skip + (cuerpo.limit ?? 100)) });
    }
    if (ruta === '/contacts/search') return json({ contacts: [] });
    return json({ message: `Ruta simulada no implementada: ${ruta}` }, 404);
  };

  return { fetch: fetchSimulado, llamadas };
}
