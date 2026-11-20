import { describe, expect, it } from 'vitest';
import { mensajeClaro } from './errores';

describe('mensajes de error claros', () => {
  it('la conversación inexistente de GHL (caso real del 20 nov) se explica sin detalles técnicos', () => {
    const tecnico =
      'GHL respondió 400 en /conversations/Omv9DZpRMEJ6Xg44nuOv/messages: {"arguments":{},"canonicalCode":"CONVERSATIONS_CONVERSATION_NOT_FOUND","error":"Bad Request","message":"No conversation found with id: Omv9DZpRMEJ6Xg44nuOv"}';
    const claro = mensajeClaro(tecnico, 'Se reintentará sola.');
    expect(claro).toBe(
      'GHL tenía una conversación que ya no existe (eliminada o fusionada). Se reintentará sola.',
    );
    expect(claro).not.toMatch(/400|\{|\/conversations/);
  });

  it.each([
    ['GHL respondió 401 en /users/: {}', 'El token de GHL no tiene permiso o venció'],
    ['GHL respondió 429 en /conversations/search: {}', 'bajar el ritmo'],
    ['GHL respondió 503 en /opportunities/search: <html>', 'no respondió a tiempo'],
    ['The operation was aborted due to timeout', 'no respondió a tiempo'],
    ['GHL respondió 0 mensajes de 2026-11-10 a 2026-11-11, pero 3 conversaciones…', 'incompletos'],
  ])('%s', (tecnico, esperado) => {
    expect(mensajeClaro(tecnico)).toContain(esperado);
  });

  it('un error técnico desconocido se resume; uno ya escrito para personas se respeta', () => {
    expect(mensajeClaro('TypeError: cannot read properties of undefined')).toBe(
      'La carga no pudo terminar.',
    );
    expect(mensajeClaro('La subcuenta no tiene sus 3 etapas de calidad configuradas.')).toBe(
      'La subcuenta no tiene sus 3 etapas de calidad configuradas.',
    );
    expect(mensajeClaro(null)).toBe('');
  });
});
