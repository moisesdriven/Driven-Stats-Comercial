import { describe, expect, it } from 'vitest';
import { canalDeTipo, clasificarOrigen, requiereVerificarIa, tipoContenido } from './origen';

const sal = (source: string | undefined, userId?: string) => ({
  direction: 'outbound',
  source,
  messageType: 'TYPE_WHATSAPP',
  userId,
});

describe('clasificarOrigen (mapeo aprobado)', () => {
  it('entrantes y actividades no llevan origen', () => {
    expect(clasificarOrigen({ direction: 'inbound', messageType: 'TYPE_WHATSAPP' })).toBeNull();
    expect(
      clasificarOrigen({
        direction: 'outbound',
        source: 'app',
        messageType: 'TYPE_ACTIVITY_OPPORTUNITY',
      }),
    ).toBeNull();
  });

  it('workflow con userId de la asesora sigue siendo workflow', () => {
    expect(clasificarOrigen(sal('workflow', 'U1'))).toBe('workflow');
    expect(clasificarOrigen(sal('api'))).toBe('workflow');
  });

  it('campañas y envíos masivos', () => {
    expect(clasificarOrigen(sal('campaign'))).toBe('campana');
    expect(clasificarOrigen(sal('bulk_actions'))).toBe('campana');
  });

  it('app con generación de IA es agente_ia aunque tenga userId', () => {
    expect(clasificarOrigen(sal('app', 'U1'), 'ia')).toBe('agente_ia');
  });

  it('app sin generación de IA y con userId es manual', () => {
    expect(clasificarOrigen(sal('app', 'U1'), 'sin_ia')).toBe('manual');
  });

  it('criterio conservador: sin verificar, con error o sin userId queda sin_origen', () => {
    expect(clasificarOrigen(sal('app', 'U1'))).toBe('sin_origen');
    expect(clasificarOrigen(sal('app', 'U1'), 'error')).toBe('sin_origen');
    expect(clasificarOrigen(sal('app'), 'sin_ia')).toBe('sin_origen');
  });

  it('solo se verifica con GHL lo que puede ser humano', () => {
    expect(requiereVerificarIa(sal('app', 'U1'))).toBe(true);
    expect(requiereVerificarIa(sal('workflow', 'U1'))).toBe(false);
    expect(requiereVerificarIa({ direction: 'inbound' })).toBe(false);
  });
});

describe('canal y contenido', () => {
  it('traduce el tipo de mensaje a canal', () => {
    expect(canalDeTipo('TYPE_WHATSAPP')).toBe('whatsapp');
    expect(canalDeTipo('TYPE_INSTAGRAM')).toBe('instagram');
    expect(canalDeTipo('TYPE_NUEVO')).toBe('nuevo');
    expect(canalDeTipo(null)).toBeNull();
  });

  it('distingue texto, plantilla y multimedia', () => {
    expect(tipoContenido({ body: 'Hola', source: 'app' })).toBe('texto');
    expect(tipoContenido({ body: 'Bienvenido', source: 'workflow' })).toBe('plantilla');
    expect(tipoContenido({ body: '', attachments: ['https://x/y/foto.JPG'] })).toBe('imagen');
    expect(tipoContenido({ body: '', attachments: ['https://x/nota.ogg?x=1'] })).toBe('audio');
    expect(tipoContenido({ body: '', attachments: ['https://x/archivo'] })).toBe('multimedia');
  });
});
