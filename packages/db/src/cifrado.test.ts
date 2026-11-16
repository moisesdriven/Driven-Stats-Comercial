import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cifrar, descifrar } from './cifrado';

const clave = randomBytes(32).toString('base64');

describe('cifrado AES-256-GCM', () => {
  it('cifra y descifra', () => {
    const c = cifrar('pit-de-prueba-123', clave);
    expect(c.startsWith('v1.')).toBe(true);
    expect(c).not.toContain('pit-de-prueba');
    expect(descifrar(c, clave)).toBe('pit-de-prueba-123');
  });

  it('usa un IV distinto en cada cifrado', () => {
    expect(cifrar('x', clave)).not.toBe(cifrar('x', clave));
  });

  it('rechaza un valor alterado', () => {
    const c = cifrar('secreto', clave);
    const partes = c.split('.');
    const alterado = Buffer.from(partes[3]!, 'base64url');
    alterado[0] = alterado[0]! ^ 1;
    partes[3] = alterado.toString('base64url');
    expect(() => descifrar(partes.join('.'), clave)).toThrow();
  });

  it('rechaza otra clave', () => {
    const c = cifrar('secreto', clave);
    expect(() => descifrar(c, randomBytes(32).toString('base64'))).toThrow();
  });

  it('exige una clave de 32 bytes', () => {
    expect(() => cifrar('x', Buffer.from('corta').toString('base64'))).toThrow(/32 bytes/);
    expect(() => cifrar('x', '')).toThrow(/CLAVE_CIFRADO/);
  });
});
