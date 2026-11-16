import { tablas, type Db } from '@driven/db';

/** Registra una acción relevante (§10.1, §11). Nunca guardar contraseñas ni tokens en `detalle`. */
export async function auditar(
  db: Db,
  quien: string | null,
  que: string,
  detalle: Record<string, unknown> = {},
): Promise<void> {
  await db.insert(tablas.auditoria).values({ quien, que, detalle });
}
