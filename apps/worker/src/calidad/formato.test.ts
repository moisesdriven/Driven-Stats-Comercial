import { describe, expect, it } from 'vitest';
import { configuracionPensamiento, parametrosSolicitud } from '@driven/db';
import { esquemaRespuesta } from './proceso';

const criterios = {
  responde: true,
  personalizado: false,
  siguiente_paso: true,
  tono: true,
  extension: false,
};

describe('lectura de la respuesta de la IA', () => {
  it('acepta el formato v2 y el de motivo primero', () => {
    const r = esquemaRespuesta.parse({
      mensajes: [
        { n: 1, categoria: 'info_producto_precio', criterios, motivo: 'Da el precio' },
        { n: 2, motivo: 'Saluda', categoria: 'saludo_plantilla', criterios },
      ],
    });
    expect(r.mensajes.map((m) => m.categoria)).toEqual([
      'info_producto_precio',
      'saludo_plantilla',
    ]);
  });

  it('lleva el formato compacto a la forma completa', () => {
    const r = esquemaRespuesta.parse({
      mensajes: [
        {
          n: 3,
          m: 'Da el precio',
          cat: 'info_producto_precio',
          r: true,
          p: false,
          s: true,
          t: true,
          e: false,
        },
      ],
    });
    expect(r.mensajes[0]).toEqual({
      n: 3,
      categoria: 'info_producto_precio',
      criterios,
      motivo: 'Da el precio',
    });
  });

  it('rechaza respuestas incompletas o con categorías desconocidas', () => {
    expect(
      esquemaRespuesta.safeParse({ mensajes: [{ n: 1, m: 'x', cat: 'otra', r: true }] }).success,
    ).toBe(false);
    expect(
      esquemaRespuesta.safeParse({ mensajes: [{ n: 1, categoria: 'seguimiento', motivo: 'x' }] })
        .success,
    ).toBe(false);
  });
});

describe('pensamiento según el modelo', () => {
  it('Haiku se apaga con disabled, Sonnet 5.5 con between_tools y Opus 5.5 no lo recibe', () => {
    expect(configuracionPensamiento('claude-haiku-5-5', false)).toEqual({ type: 'disabled' });
    expect(configuracionPensamiento('claude-sonnet-5-5', false)).toEqual({
      type: 'between_tools',
    });
    expect(configuracionPensamiento('claude-opus-5-5', false)).toBeUndefined();
    expect(configuracionPensamiento('claude-sonnet-5-5', true)).toEqual({ type: 'adaptive' });
    const p = parametrosSolicitud({ texto: 'x', mensajes: 1 }, 'claude-opus-5-5');
    expect(JSON.parse(JSON.stringify(p))).not.toHaveProperty('thinking');
  });
});
