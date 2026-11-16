/**
 * Proveedor de lotes (Message Batches API). La implementación real usa el SDK oficial; las pruebas
 * usan un proveedor simulado (nunca la API real ni claves reales).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { parametrosSolicitud } from '@driven/db';

export type ParametrosSolicitud = ReturnType<typeof parametrosSolicitud>;

export interface SolicitudLote {
  custom_id: string;
  params: ParametrosSolicitud;
}

export interface UsoRespuesta {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export interface ResultadoLote {
  custom_id: string;
  tipo: 'succeeded' | 'errored' | 'canceled' | 'expired';
  /** Texto de la respuesta (JSON de la rúbrica) si tuvo éxito. */
  texto?: string;
  stopReason?: string | null;
  uso?: UsoRespuesta;
  error?: string;
}

export interface ProveedorLotes {
  crearLote(solicitudes: SolicitudLote[]): Promise<string>;
  /** `ended` cuando todas las solicitudes del lote terminaron. */
  estadoLote(id: string): Promise<'in_progress' | 'canceling' | 'ended'>;
  resultados(id: string): AsyncIterable<ResultadoLote>;
}

/** Límites vigentes de la Batches API: 100.000 solicitudes o 256 MB por lote. */
export const MAX_SOLICITUDES_LOTE = 100_000;
export const MAX_BYTES_LOTE = 256 * 1024 * 1024;

export class ProveedorAnthropic implements ProveedorLotes {
  private readonly cliente: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    // Sin clave explícita el SDK usa las credenciales del entorno.
    this.cliente = apiKey ? new Anthropic({ apiKey }) : new Anthropic();
  }

  async crearLote(solicitudes: SolicitudLote[]): Promise<string> {
    const lote = await this.cliente.messages.batches.create({
      requests: solicitudes as unknown as Anthropic.Messages.BatchCreateParams['requests'],
    });
    return lote.id;
  }

  async estadoLote(id: string) {
    const lote = await this.cliente.messages.batches.retrieve(id);
    return lote.processing_status;
  }

  async *resultados(id: string): AsyncIterable<ResultadoLote> {
    for await (const r of await this.cliente.messages.batches.results(id)) {
      if (r.result.type === 'succeeded') {
        const m = r.result.message;
        const texto = m.content
          .filter((b) => b.type === 'text')
          .map((b) => (b as { text: string }).text)
          .join('');
        yield {
          custom_id: r.custom_id,
          tipo: 'succeeded',
          texto,
          stopReason: m.stop_reason,
          uso: m.usage,
        };
      } else if (r.result.type === 'errored') {
        yield {
          custom_id: r.custom_id,
          tipo: 'errored',
          error:
            `${r.result.error.error?.type ?? 'error'}: ${r.result.error.error?.message ?? ''}`.slice(
              0,
              300,
            ),
        };
      } else {
        yield { custom_id: r.custom_id, tipo: r.result.type };
      }
    }
  }
}

/** Divide las solicitudes respetando los límites de un lote. */
export function dividirEnLotes(
  solicitudes: SolicitudLote[],
  maxSolicitudes = 10_000,
): SolicitudLote[][] {
  const lotes: SolicitudLote[][] = [];
  let actual: SolicitudLote[] = [];
  let bytes = 0;
  for (const s of solicitudes) {
    const tam = Buffer.byteLength(JSON.stringify(s));
    if (
      actual.length &&
      (actual.length >= Math.min(maxSolicitudes, MAX_SOLICITUDES_LOTE) ||
        bytes + tam > MAX_BYTES_LOTE * 0.9)
    ) {
      lotes.push(actual);
      actual = [];
      bytes = 0;
    }
    actual.push(s);
    bytes += tam;
  }
  if (actual.length) lotes.push(actual);
  return lotes;
}
