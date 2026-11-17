/**
 * purga:textos (diario): borra el texto de los mensajes con más de 90 días. Se conservan el resto de
 * columnas del mensaje y las clasificaciones de calidad. Por lotes, para no bloquear la tabla.
 * Un mensaje de entrada al CRM ("Headline: …") queda con la marca "*Headline*" (sin su contenido)
 * para que siga sin contarse como mensaje del cliente.
 */
import { sql } from 'drizzle-orm';
import {
  corteRetencionTexto,
  DIAS_RETENCION_TEXTO,
  PATRON_MENSAJE_ENTRADA_SQL,
} from '@driven/core';
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
        where fecha < ${corte} and texto is not null and texto <> '*Headline*'
        limit ${LOTE}
      )
      update comercial.mensajes m
      set texto = case when m.texto ~* ${PATRON_MENSAJE_ENTRADA_SQL} then '*Headline*' end
      from lote where m.message_id = lote.message_id and m.fecha = lote.fecha`);
    const n = r.rowCount ?? 0;
    total += n;
    if (n < LOTE) break;
  }
  log('purga_textos', { dias: DIAS_RETENCION_TEXTO, corte: corte.toISOString(), mensajes: total });
  return total;
}
