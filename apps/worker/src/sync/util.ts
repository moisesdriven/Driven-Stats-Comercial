import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '@driven/db';

/** Ejecuta `fn` sobre los elementos con concurrencia limitada (el limitador de GHL regula el ritmo). */
export async function enParalelo<T, R>(
  elementos: readonly T[],
  concurrencia: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const resultados: R[] = new Array(elementos.length);
  let siguiente = 0;
  const trabajadores = Array.from(
    { length: Math.min(concurrencia, elementos.length) },
    async () => {
      while (siguiente < elementos.length) {
        const i = siguiente++;
        resultados[i] = await fn(elementos[i]!);
      }
    },
  );
  await Promise.all(trabajadores);
  return resultados;
}

export function enLotes<T>(elementos: readonly T[], tamano: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < elementos.length; i += tamano) lotes.push(elementos.slice(i, i + tamano));
  return lotes;
}

export const fechaONula = (v: string | number | null | undefined): Date | null => {
  if (v === null || v === undefined || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Lista de valores para `IN (...)` / `ANY(...)`. */
export const lista = (valores: readonly string[]): SQL =>
  sql`${sql.join(
    valores.map((v) => sql`${v}`),
    sql`, `,
  )}`;

export async function ejecutar(db: Db, consulta: SQL) {
  return db.execute(consulta);
}

/** Registro estructurado en stdout (docker logs). Nunca incluir tokens ni textos de mensajes. */
export function log(evento: string, datos: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ t: new Date().toISOString(), evento, ...datos }));
}
