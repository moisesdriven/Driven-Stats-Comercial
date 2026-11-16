/**
 * Recálculo pendiente del resumen diario: cuando en la web cambia el modo de tiempo, la zona horaria
 * o una ausencia pasada de una subcuenta, se marca `horario_general.recalcularDesde` y este proceso
 * recalcula desde esa fecha hasta hoy. La marca se borra solo si no cambió mientras tanto.
 */
import { sql } from 'drizzle-orm';
import { configuracionTiempo } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { log } from '../sync/util';
import { calcularResumen, hoyEn, sumarDias } from './resumen';

/** Como mucho se recalculan 180 días (más atrás no hay datos útiles para las vistas). */
const MAX_DIAS = 180;

export async function recalcularPendientes(db: Db, ahora = new Date()): Promise<number> {
  const subs = await db.select().from(tablas.subcuentas);
  let hechas = 0;
  for (const s of subs) {
    const cfg = configuracionTiempo(s.horarioGeneral);
    if (!s.activa || !cfg.recalcularDesde) continue;
    const hoy = hoyEn(s.zonaHoraria, ahora);
    const limite = sumarDias(hoy, -MAX_DIAS + 1);
    const desde = cfg.recalcularDesde < limite ? limite : cfg.recalcularDesde;
    if (desde <= hoy) {
      const r = await calcularResumen(db, s.locationId, { desde, hasta: hoy, ahora });
      log('resumen_recalculado', {
        locationId: s.locationId,
        desde,
        hasta: hoy,
        filas: r.filas,
        ms: r.ms,
      });
    }
    await db.execute(sql`
      update comercial.subcuentas set horario_general = horario_general - 'recalcularDesde'
      where location_id = ${s.locationId} and horario_general->>'recalcularDesde' = ${cfg.recalcularDesde}`);
    hechas++;
  }
  return hechas;
}
