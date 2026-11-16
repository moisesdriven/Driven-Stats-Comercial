import { describe, expect, it } from 'vitest';
import { colores } from './tokens';

describe('tokens', () => {
  it('usa el azul eléctrico aprobado como primario', () => {
    expect(colores.primario).toBe('#1F5BFF');
  });
});
