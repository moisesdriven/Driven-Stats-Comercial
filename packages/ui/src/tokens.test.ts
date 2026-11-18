import { describe, expect, it } from 'vitest';
import { colores, type ParColor } from './tokens';

const luminancia = (hex: string) => {
  const [r, g, b] = (hex.slice(1).match(/../g) ?? []).map((x) => {
    const v = parseInt(x, 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contraste = (a: string, b: string) => {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
};
const modos = ['claro', 'oscuro'] as const;
const en = (par: ParColor, modo: (typeof modos)[number]) => par[modo];

describe('tokens', () => {
  it('conserva el azul de Driven como primario', () => {
    expect(colores.primario).toBe('#1F5BFF');
  });

  it.each(modos)('el texto cumple 4,5:1 sobre sus fondos en modo %s', (modo) => {
    for (const fondo of [colores.fondo, colores.superficie, colores.superficieSuave]) {
      expect(contraste(en(colores.texto, modo), en(fondo, modo))).toBeGreaterThanOrEqual(4.5);
      expect(contraste(en(colores.textoSecundario, modo), en(fondo, modo))).toBeGreaterThanOrEqual(
        4.5,
      );
    }
    expect(contraste(en(colores.marca, modo), en(colores.superficie, modo))).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contraste(en(colores.marca, modo), en(colores.marcaSuave, modo))).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(modos)('los estados cumplen 4,5:1 sobre su fondo en modo %s', (modo) => {
    for (const e of [colores.verde, colores.amarillo, colores.rojo]) {
      expect(contraste(en(e.texto, modo), en(e.fondo, modo))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(modos)('los bordes de controles cumplen 3:1 en modo %s', (modo) => {
    expect(
      contraste(en(colores.control, modo), en(colores.superficie, modo)),
    ).toBeGreaterThanOrEqual(3);
  });
});
