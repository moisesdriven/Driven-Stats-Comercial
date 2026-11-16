/**
 * Origen de cada mensaje (docs/mapeo-origen.md §3, aprobado por el cliente).
 * Un mensaje cuenta como humano para los indicadores SOLO si su origen es `manual`.
 */

export const ORIGENES = ['manual', 'workflow', 'agente_ia', 'campana', 'sin_origen'] as const;
export type Origen = (typeof ORIGENES)[number];

/** Resultado de consultar `GET /conversation-ai/generations` para un mensaje. */
export type ResultadoGeneracionIa = 'ia' | 'sin_ia' | 'error';

export interface MensajeGhlBasico {
  direction: 'inbound' | 'outbound' | string;
  source?: string | null | undefined;
  messageType?: string | null | undefined;
  userId?: string | null | undefined;
}

export const esActividad = (m: MensajeGhlBasico) =>
  (m.messageType ?? '').startsWith('TYPE_ACTIVITY_');

/** ¿Hay que preguntar a GHL si el mensaje lo generó el agente de IA? */
export function requiereVerificarIa(m: MensajeGhlBasico): boolean {
  return m.direction === 'outbound' && !esActividad(m) && (m.source === 'app' || !m.source);
}

/**
 * Clasifica un mensaje saliente. Devuelve `null` para entrantes y actividades (no llevan origen).
 * `generacion` solo se usa cuando `requiereVerificarIa` es verdadero; si falta, el origen queda
 * `sin_origen` hasta verificarlo (criterio conservador: no se cuenta como humano).
 */
export function clasificarOrigen(
  m: MensajeGhlBasico,
  generacion?: ResultadoGeneracionIa | null,
): Origen | null {
  if (m.direction !== 'outbound' || esActividad(m)) return null;
  switch (m.source) {
    case 'campaign':
    case 'bulk_actions':
      return 'campana';
    case 'workflow':
    case 'api':
      return 'workflow';
  }
  if (generacion === 'ia') return 'agente_ia';
  if (generacion === 'sin_ia' && m.userId) return 'manual';
  return 'sin_origen';
}

const CANALES: Record<string, string> = {
  TYPE_WHATSAPP: 'whatsapp',
  TYPE_INSTAGRAM: 'instagram',
  TYPE_FACEBOOK: 'facebook',
  TYPE_FB_MESSENGER: 'facebook',
  TYPE_SMS: 'sms',
  TYPE_RCS: 'sms',
  TYPE_EMAIL: 'email',
  TYPE_WEBCHAT: 'webchat',
  TYPE_LIVE_CHAT: 'webchat',
  TYPE_CALL: 'llamada',
  TYPE_GMB: 'google',
  TYPE_TIKTOK: 'tiktok',
};

export function canalDeTipo(messageType: string | null | undefined): string | null {
  if (!messageType) return null;
  return CANALES[messageType] ?? messageType.replace(/^TYPE_/, '').toLowerCase();
}

const EXTENSIONES: [RegExp, string][] = [
  [/\.(jpe?g|png|gif|webp|heic)(\?|$)/i, 'imagen'],
  [/\.(mp3|ogg|oga|opus|m4a|wav|aac|amr)(\?|$)/i, 'audio'],
  [/\.(mp4|mov|3gp|webm)(\?|$)/i, 'video'],
  [/\.(pdf|docx?|xlsx?|pptx?|txt|csv)(\?|$)/i, 'documento'],
];

/**
 * Tipo de contenido: texto, imagen, audio, video, documento, multimedia (adjunto sin tipo claro) o
 * plantilla (mensaje de workflow o campaña con texto: textos fijos).
 */
export function tipoContenido(m: {
  body?: string | null | undefined;
  attachments?: readonly string[] | null | undefined;
  source?: string | null | undefined;
}): string {
  const adjuntos = m.attachments ?? [];
  const texto = (m.body ?? '').trim();
  if (adjuntos.length && !texto) {
    for (const [re, tipo] of EXTENSIONES) if (adjuntos.some((a) => re.test(a))) return tipo;
    return 'multimedia';
  }
  if (
    texto &&
    (m.source === 'workflow' || m.source === 'campaign' || m.source === 'bulk_actions')
  ) {
    return 'plantilla';
  }
  return texto ? 'texto' : 'multimedia';
}
