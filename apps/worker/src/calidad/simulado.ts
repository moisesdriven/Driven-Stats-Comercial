/** Proveedor de lotes simulado para pruebas: califica con reglas fijas, sin llamar a ninguna API. */
import type { ProveedorLotes, ResultadoLote, SolicitudLote } from './proveedor';

export interface OpcionesSimulado {
  /** custom_id (o parte) que responde JSON inválido la primera vez. */
  invalidoUnaVez?: string;
  /** custom_id (o parte) que siempre responde con error. */
  siempreError?: string;
  /** Veces que `estadoLote` responde in_progress antes de `ended`. */
  esperas?: number;
}

export function crearProveedorSimulado(o: OpcionesSimulado = {}) {
  const lotes = new Map<string, SolicitudLote[]>();
  const consultas = new Map<string, number>();
  const yaInvalido = new Set<string>();
  let n = 0;
  const proveedor: ProveedorLotes = {
    async crearLote(solicitudes) {
      const id = `msgbatch_sim_${++n}`;
      lotes.set(id, solicitudes);
      return id;
    },
    async estadoLote(id) {
      const c = (consultas.get(id) ?? 0) + 1;
      consultas.set(id, c);
      return c > (o.esperas ?? 0) ? 'ended' : 'in_progress';
    },
    async *resultados(id): AsyncIterable<ResultadoLote> {
      for (const s of lotes.get(id) ?? []) {
        const uso = { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 700 };
        if (o.siempreError && s.custom_id.includes(o.siempreError)) {
          yield { custom_id: s.custom_id, tipo: 'errored', error: 'api_error: simulado' };
          continue;
        }
        if (
          o.invalidoUnaVez &&
          s.custom_id.includes(o.invalidoUnaVez) &&
          !yaInvalido.has(s.custom_id)
        ) {
          yaInvalido.add(s.custom_id);
          yield {
            custom_id: s.custom_id,
            tipo: 'succeeded',
            texto: '{"mensajes": [ roto',
            stopReason: 'end_turn',
            uso,
          };
          continue;
        }
        const contenido = s.params.messages[0]!.content;
        const marcados = [...contenido.matchAll(/\[ASESOR #(\d+)\] (.*)/g)];
        const mensajes = marcados.map(([, num, texto]) => {
          const t = texto ?? '';
          const precio = /S\/|precio|cuesta/i.test(t);
          const pregunta = t.includes('?');
          return {
            n: Number(num),
            categoria: precio ? 'info_producto_precio' : 'saludo_plantilla',
            criterios: {
              responde: precio,
              personalizado: /María|Juan/.test(t),
              siguiente_paso: pregunta,
              tono: true,
              extension: t.length < 400,
            },
            motivo: precio ? 'Responde el precio' : 'Mensaje genérico',
          };
        });
        yield {
          custom_id: s.custom_id,
          tipo: 'succeeded',
          texto: JSON.stringify({ mensajes }),
          stopReason: 'end_turn',
          uso,
        };
      }
    },
  };
  return { proveedor, lotes };
}
