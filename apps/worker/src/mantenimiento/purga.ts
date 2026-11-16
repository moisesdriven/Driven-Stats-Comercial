/**
 * purga:textos (diario): borra el texto de los mensajes con más de 90 días. Se conservan el resto de
 * columnas del mensaje y las clasificaciones de calidad. Por lotes, para no bloquear la tabla.
 */
import { sql } from 'drizzle-orm';
import { corteRetencionTexto, DIAS_RETENCION_TEXTO } from '@driven/core';
import type { Db } from '@driven/db';
import { log } from '../sync/util';

const LOTE = 5000;

export async function purgarTextos(db: Db, ahora = new Date()): Promise<number> {
  const corte = corteRetencionTexto(ahora);
  let total = 0;
  for (;;) {
    const r = await db.execute(sql`
      with lote as (
        select message_id, fecha from comercial.mensajes
        where fecha < ${corte} and texto is not null
        limit ${LOTE}
      )
      update comercial.mensajes m set texto = null
      from lote where m.message_id = lote.message_id and m.fecha = lote.fecha`);
    const n = r.rowCount ?? 0;
    total += n;
    if (n < LOTE) break;
  }
  log('purga_textos', { dias: DIAS_RETENCION_TEXTO, corte: corte.toISOString(), mensajes: total });
  return total;
}
