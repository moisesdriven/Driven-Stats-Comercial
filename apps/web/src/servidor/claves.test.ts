import { describe, expect, it } from 'vitest';
import { generarClaveTemporal, hashearClave, validarClaveNueva, verificarClave } from './claves';

describe('claves', () => {
  it('hashea con Argon2id y verifica', async () => {
    const h = await hashearClave('ClaveSegura123');
    expect(h.startsWith('$argon2id$')).toBe(true);
    expect(await verificarClave(h, 'ClaveSegura123')).toBe(true);
    expect(await verificarClave(h, 'otra')).toBe(false);
    expect(await verificarClave('basura', 'x')).toBe(false);
  });

  it('genera claves temporales válidas y distintas', () => {
    const a = generarClaveTemporal();
    expect(validarClaveNueva(a)).toBeNull();
    expect(a).not.toBe(generarClaveTemporal());
  });

  it('exige largo mínimo, letras y números', () => {
    expect(validarClaveNueva('corta1')).not.toBeNull();
    expect(validarClaveNueva('sololetrassss')).not.toBeNull();
    expect(validarClaveNueva('1234567890123')).not.toBeNull();
    expect(validarClaveNueva('letras12345')).toBeNull();
  });
});
