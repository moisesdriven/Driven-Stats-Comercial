/**
 * Mensajes de error para las personas (pedido del cliente del 20 nov 2026): cortos, en español y
 * sin detalles técnicos. El texto técnico original se guarda igual en la base y en los registros
 * del worker para soporte; la pantalla lo ofrece solo como ayuda emergente.
 */
const REGLAS: [RegExp, string][] = [
  [
    /respondió (401|403)\b|not authorized|Falta el token/i,
    'El token de GHL no tiene permiso o venció. Renuévalo en «Subcuentas y tokens».',
  ],
  [
    /CONVERSATION_NOT_FOUND|No conversation found|respondió 404\b/i,
    'GHL tenía una conversación que ya no existe (eliminada o fusionada).',
  ],
  [
    /respondió 429\b|rate limit|too many requests/i,
    'GHL pidió bajar el ritmo de consultas por un momento.',
  ],
  [
    /respondió 0 mensajes|respondió vacía|mensajes pendientes/i,
    'GHL entregó los mensajes incompletos por un momento.',
  ],
  [
    /respondió 5\d\d\b|timeout|timed out|aborted|ECONN|ETIMEDOUT|fetch failed|socket/i,
    'GHL no respondió a tiempo.',
  ],
  [/anthropic|overloaded|Batches/i, 'El servicio de IA no respondió.'],
];

/**
 * Traduce un error técnico a una frase clara. `reintento` agrega qué pasa después (por ejemplo,
 * «Se reintentará sola.»).
 */
export function mensajeClaro(error: string | null | undefined, reintento?: string): string {
  if (!error) return '';
  const regla = REGLAS.find(([patron]) => patron.test(error));
  // Los mensajes que ya escribimos en español para las personas se muestran tal cual.
  const base = regla
    ? regla[1]
    : /^(GHL|Error|[A-Za-z]+Error)\b|https?:\/\/|\{"/.test(error)
      ? 'La carga no pudo terminar.'
      : error;
  return reintento ? `${base} ${reintento}` : base;
}
