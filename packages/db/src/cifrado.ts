/**
 * Cifrado AES-256-GCM de tokens de GHL y secretos TOTP (§2, §11).
 * Formato guardado: `v1.<iv>.<tag>.<cifrado>` en base64url. La clave (32 bytes en base64) vive solo en
 * la variable de entorno CLAVE_CIFRADO.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

function leerClave(claveBase64: string | undefined): Buffer {
  if (!claveBase64) throw new Error('Falta la variable CLAVE_CIFRADO.');
  const clave = Buffer.from(claveBase64, 'base64');
  if (clave.length !== 32)
    throw new Error('CLAVE_CIFRADO debe tener 32 bytes codificados en base64.');
  return clave;
}

export function cifrar(texto: string, claveBase64 = process.env.CLAVE_CIFRADO): string {
  const clave = leerClave(claveBase64);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', clave, iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, cifrado]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export function descifrar(valor: string, claveBase64 = process.env.CLAVE_CIFRADO): string {
  const clave = leerClave(claveBase64);
  const partes = valor.split('.');
  if (partes.length !== 4 || partes[0] !== VERSION)
    throw new Error('Formato de cifrado no reconocido.');
  const [, iv, tag, cifrado] = partes.map((p) => Buffer.from(p, 'base64url')) as [
    Buffer,
    Buffer,
    Buffer,
    Buffer,
  ];
  const decipher = createDecipheriv('aes-256-gcm', clave, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(cifrado), decipher.final()]).toString('utf8');
}
