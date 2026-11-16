/** POST JSON a la API propia. Devuelve el cuerpo y el estado; nunca lanza por estados HTTP. */
export async function enviar(
  ruta: string,
  cuerpo: unknown,
): Promise<{ ok: boolean; estado: number; datos: Record<string, unknown> }> {
  const res = await fetch(ruta, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
    credentials: 'same-origin',
  });
  const datos = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { ok: res.ok, estado: res.status, datos };
}
