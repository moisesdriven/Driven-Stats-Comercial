/** Horario laboral y ausencias de una subcuenta para cálculos en vivo (listas para actuar). */
import { eq } from 'drizzle-orm';
import type { Ausencia, TiempoAsesor, Tramo } from '@driven/core';
import { tablas, type Db } from '@driven/db';

export async function tiemposSubcuenta(
  db: Db,
  locationId: string,
  zona: string,
): Promise<(asesor: string | null) => TiempoAsesor> {
  const [horarios, ausencias] = await Promise.all([
    db.select().from(tablas.horarios).where(eq(tablas.horarios.locationId, locationId)),
    db.select().from(tablas.ausencias).where(eq(tablas.ausencias.locationId, locationId)),
  ]);
  const tramos = new Map<string, Tramo[]>();
  for (const h of horarios) {
    const k = h.userId ?? '';
    const l = tramos.get(k) ?? [];
    l.push({
      diaSemana: h.diaSemana,
      inicio: h.horaInicio.slice(0, 5),
      fin: h.horaFin.slice(0, 5),
      vigenteDesde: h.vigenteDesde,
      vigenteHasta: h.vigenteHasta,
    });
    tramos.set(k, l);
  }
  const feriados: Ausencia[] = ausencias
    .filter((a) => !a.userId)
    .map((a) => ({ inicio: a.inicio, fin: a.fin }));
  const cache = new Map<string, TiempoAsesor>();
  return (asesor) => {
    const k = asesor ?? '';
    let t = cache.get(k);
    if (!t) {
      t = {
        horario: tramos.get(k) ?? tramos.get('') ?? [],
        ausencias: [
          ...feriados,
          ...ausencias
            .filter((a) => a.userId && a.userId === asesor)
            .map((a) => ({ inicio: a.inicio, fin: a.fin })),
        ],
        zona,
      };
      cache.set(k, t);
    }
    return t;
  };
}
