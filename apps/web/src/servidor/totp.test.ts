import { describe, expect, it } from 'vitest';
import {
  base32Codificar,
  base32Decodificar,
  codigoTotp,
  generarSecretoTotp,
  verificarCodigoTotp,
} from './totp';

// Vector de prueba del RFC 6238 (SHA-1): secreto ASCII "12345678901234567890".
const SECRETO_RFC = base32Codificar(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238)', () => {
  it('cumple los vectores oficiales (6 últimos dígitos)', () => {
    expect(codigoTotp(SECRETO_RFC, 59_000, 8)).toBe('94287082');
    expect(codigoTotp(SECRETO_RFC, 1_111_111_109_000, 8)).toBe('07081804');
    expect(codigoTotp(SECRETO_RFC, 1_234_567_890_000, 8)).toBe('89005924');
    expect(codigoTotp(SECRETO_RFC, 59_000)).toBe('287082');
  });

  it('base32 ida y vuelta', () => {
    const datos = Buffer.from('hola mundo, driven');
    expect(base32Decodificar(base32Codificar(datos)).equals(datos)).toBe(true);
  });

  it('verifica con tolerancia de un paso y rechaza códigos viejos', () => {
    const s = generarSecretoTotp();
    const ahora = 1_800_000_000_000;
    expect(verificarCodigoTotp(s, codigoTotp(s, ahora), ahora)).toBe(true);
    expect(verificarCodigoTotp(s, codigoTotp(s, ahora - 30_000), ahora)).toBe(true);
    expect(verificarCodigoTotp(s, codigoTotp(s, ahora - 120_000), ahora)).toBe(false);
    expect(verificarCodigoTotp(s, 'abc123', ahora)).toBe(false);
  });
});
