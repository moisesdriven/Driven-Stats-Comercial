import { randomInt } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';

/** Parámetros Argon2id (recomendación OWASP: m=19 MiB, t=2, p=1). */
const OPCIONES = { memoryCost: 19456, timeCost: 2, parallelism: 1, algorithm: 2 } as const;

export const LONGITUD_MINIMA_CLAVE = 10;

export function hashearClave(clave: string): Promise<string> {
  return hash(clave, OPCIONES);
}

export async function verificarClave(hashGuardado: string, clave: string): Promise<boolean> {
  try {
    return await verify(hashGuardado, clave);
  } catch {
    return false;
  }
}

/** Hash de relleno para igualar el tiempo de respuesta cuando el correo no existe. */
let hashRelleno: Promise<string> | undefined;
export function obtenerHashRelleno(): Promise<string> {
  hashRelleno ??= hashearClave('relleno-para-tiempo-constante');
  return hashRelleno;
}

export function validarClaveNueva(clave: string): string | null {
  if (clave.length < LONGITUD_MINIMA_CLAVE) {
    return `La contraseña debe tener al menos ${LONGITUD_MINIMA_CLAVE} caracteres.`;
  }
  if (!/[a-zA-Z]/.test(clave) || !/\d/.test(clave)) {
    return 'La contraseña debe incluir letras y números.';
  }
  return null;
}

/** Contraseña temporal legible (sin caracteres ambiguos). Debe cambiarse al primer ingreso. */
export function generarClaveTemporal(longitud = 14): string {
  const letras = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ';
  const digitos = '23456789';
  const todos = letras + digitos;
  const caracteres = [letras[randomInt(letras.length)]!, digitos[randomInt(digitos.length)]!];
  while (caracteres.length < longitud) caracteres.push(todos[randomInt(todos.length)]!);
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [caracteres[i], caracteres[j]] = [caracteres[j]!, caracteres[i]!];
  }
  return caracteres.join('');
}
