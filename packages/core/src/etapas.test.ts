import { describe, expect, it } from 'vitest';
import { ETAPAS_PROCESO, peorEstado } from './etapas';

describe('etapas', () => {
  it('mantiene el orden del proceso', () => {
    expect(ETAPAS_PROCESO).toEqual(['atencion', 'seguimiento', 'negociacion', 'cierre']);
  });

  it('peorEstado devuelve el estado más grave', () => {
    expect(peorEstado(['verde', 'amarillo', 'verde'])).toBe('amarillo');
    expect(peorEstado(['verde', 'rojo', 'amarillo'])).toBe('rojo');
    expect(peorEstado(['verde'])).toBe('verde');
  });

  it('peorEstado sin estados devuelve null', () => {
    expect(peorEstado([])).toBeNull();
  });
});
