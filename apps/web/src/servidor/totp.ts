/**
 * TOTP (RFC 6238) con HMAC-SHA1, 6 dígitos y pasos de 30 s: compatible con Google Authenticator,
 * Microsoft Authenticator, 1Password, etc. Sin dependencias externas.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Codificar(datos: Buffer): string {
  let bits = 0;
  let valor = 0;
  let salida = '';
  for (const byte of datos) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      salida += ALFABETO[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) salida += ALFABETO[(valor << (5 - bits)) & 31];
  return salida;
}

export function base32Decodificar(texto: string): Buffer {
  const limpio = texto.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = 0;
  let valor = 0;
  const bytes: number[] = [];
  for (const c of limpio) {
    const i = ALFABETO.indexOf(c);
    if (i === -1) throw new Error('Secreto base32 inválido.');
    valor = (valor << 5) | i;
    bits += 5;
    if (bits >= 8) {
      bytes.push((valor >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generarSecretoTotp(): string {
  return base32Codificar(randomBytes(20));
}

export function codigoTotp(secreto: string, instante = Date.now(), digitos = 6, paso = 30): string {
  const contador = Math.floor(instante / 1000 / paso);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac('sha1', base32Decodificar(secreto)).update(buf).digest();
  const desplazamiento = hmac[hmac.length - 1]! & 0x0f;
  const numero = (hmac.readUInt32BE(desplazamiento) & 0x7fffffff) % 10 ** digitos;
  return numero.toString().padStart(digitos, '0');
}

/** Acepta el código del paso actual y uno antes o después (tolerancia de reloj de ±30 s). */
export function verificarCodigoTotp(
  secreto: string,
  codigo: string,
  instante = Date.now(),
): boolean {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return false;
  for (const delta of [-1, 0, 1]) {
    const esperado = codigoTotp(secreto, instante + delta * 30_000);
    if (timingSafeEqual(Buffer.from(esperado), Buffer.from(limpio))) return true;
  }
  return false;
}

export function uriTotp(secreto: string, correo: string): string {
  const emisor = 'Driven Comercial';
  return `otpauth://totp/${encodeURIComponent(`${emisor}:${correo}`)}?secret=${secreto}&issuer=${encodeURIComponent(emisor)}&algorithm=SHA1&digits=6&period=30`;
}
