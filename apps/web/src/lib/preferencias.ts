/**
 * Preferencias de vista de cada usuario, guardadas en cookies (no son datos: si se pierden, se
 * vuelve al valor por defecto). Las lee el servidor para dibujar la página ya con ellas, sin
 * destello.
 */
export const COOKIE_TEMA = 'tema';
export type Tema = 'claro' | 'oscuro';
export const esTema = (v: unknown): v is Tema => v === 'claro' || v === 'oscuro';

export const COOKIE_MENU = 'menu';
export const MENU_CONTRAIDO = 'contraido';

/** Guarda una preferencia por un año (solo en el navegador). */
export function guardarPreferencia(nombre: string, valor: string): void {
  document.cookie = `${nombre}=${encodeURIComponent(valor)}; path=/; max-age=31536000; samesite=lax`;
}
