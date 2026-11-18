/** Nombre visible de cada canal de GHL (columna `canal` de leads y del resumen diario). */
export const NOMBRE_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  facebook: 'Facebook',
  sms: 'SMS',
  email: 'Correo',
  webchat: 'Chat web',
  llamada: 'Llamada',
  google: 'Google',
  tiktok: 'TikTok',
};

export const nombreCanal = (c: string) => NOMBRE_CANAL[c] ?? c.charAt(0).toUpperCase() + c.slice(1);

/** Canal pedido en la URL (`?canal=`): solo se acepta si está entre los que tienen datos. */
export function leerCanal(
  params: Record<string, string | string[] | undefined>,
  disponibles?: readonly string[],
): string | null {
  const v = typeof params.canal === 'string' ? params.canal.trim().toLowerCase() : '';
  if (!v || !/^[a-z_]{1,30}$/.test(v)) return null;
  return disponibles && !disponibles.includes(v) ? null : v;
}
