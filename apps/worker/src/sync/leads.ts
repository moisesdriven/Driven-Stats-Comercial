/**
 * Recalcula los campos básicos de los leads (un lead por contacto y subcuenta) a partir de
 * mensajes, oportunidades y mapa de etapas, y registra sus eventos. Los minutos laborales, intentos,
 * respuesta efectiva y abandono se calculan en la fase 3 (packages/core, horario laboral).
 *
 * Reglas (docs/mapeo-origen.md):
 * - Ingreso = primer mensaje entrante. Si la conversación existía más de 1 día antes del primer
 *   mensaje cargado, el ingreso real es anterior a la carga (no cuenta como lead del periodo).
 * - Primera respuesta automática = primer saliente workflow/agente_ia/campaña tras el ingreso;
 *   humana = primer saliente `manual` tras el ingreso.
 * - Asesor = el de la oportunidad vigente; si no hay, el asignado a la conversación; si no, quien dio
 *   la primera respuesta humana.
 * - Estado: perdido (oportunidad lost/abandoned), ganado (venta vigente) o abierto.
 */
import { sql } from 'drizzle-orm';
import type { Db } from '@driven/db';
import { lista } from './util';

export async function recalcularLeads(
  db: Db,
  locationId: string,
  contactos?: string[],
): Promise<number> {
  if (contactos && contactos.length === 0) return 0;
  const filtro = contactos ? sql`and contact_id in (${lista(contactos)})` : sql``;
  const r = await db.execute<{ contact_id: string }>(sql`
    with m as (
      select * from comercial.mensajes where location_id = ${locationId} and contact_id is not null ${filtro}
    ),
    ingreso as (
      select distinct on (contact_id) contact_id, fecha as ingreso_en, conversation_id, canal
      from m where direccion = 'inbound' order by contact_id, fecha
    ),
    agregados as (
      select m.contact_id,
        min(m.fecha) as primer_mensaje,
        min(m.fecha) filter (where m.direccion = 'outbound' and m.origen in ('workflow','agente_ia','campana') and m.fecha >= i.ingreso_en) as resp_auto,
        min(m.fecha) filter (where m.origen = 'manual' and m.fecha >= i.ingreso_en) as resp_humana,
        max(m.fecha) filter (where m.direccion = 'inbound') as ultimo_in,
        max(m.fecha) filter (where m.direccion = 'outbound') as ultimo_out,
        max(m.fecha) filter (where m.origen = 'manual') as ultimo_humano
      from m join ingreso i using (contact_id)
      group by m.contact_id
    ),
    primer_humano as (
      select distinct on (m.contact_id) m.contact_id, m.user_id
      from m join ingreso i using (contact_id)
      where m.origen = 'manual' and m.fecha >= i.ingreso_en
      order by m.contact_id, m.fecha
    ),
    opp as (
      select distinct on (o.contact_id) o.*
      from comercial.oportunidades o
      where o.location_id = ${locationId} and o.contact_id in (select contact_id from ingreso)
      order by o.contact_id, o.creada_en desc nulls last
    )
    insert into comercial.leads as l (
      location_id, contact_id, conversation_id, opportunity_id, canal, campana, asesor_id, asignado_en,
      ingreso_en, ingreso_anterior_a_carga, primera_resp_auto_en, primera_resp_humana_en, primera_resp_humana_por,
      ultimo_inbound_en, ultimo_outbound_en, ultimo_humano_en, estado, etapa_estandar
    )
    select ${locationId}, i.contact_id, i.conversation_id, opp.opportunity_id, i.canal, opp.fuente,
      coalesce(opp.asesor_id, l0.asignado_conversacion, ph.user_id),
      opp.creada_en,
      i.ingreso_en,
      coalesce(l0.conversacion_creada_en < a.primer_mensaje - interval '1 day', false),
      a.resp_auto, a.resp_humana, ph.user_id,
      a.ultimo_in, a.ultimo_out, a.ultimo_humano,
      case
        when opp.status in ('lost','abandoned') then 'perdido'
        when opp.venta_en is not null and opp.venta_cancelada_en is null then 'ganado'
        else 'abierto'
      end,
      me.etapa_estandar
    from ingreso i
    join agregados a using (contact_id)
    left join primer_humano ph using (contact_id)
    left join opp using (contact_id)
    left join comercial.leads l0 on l0.location_id = ${locationId} and l0.contact_id = i.contact_id
    left join comercial.mapa_etapas me on me.location_id = ${locationId} and me.stage_id = opp.stage_id
    on conflict (location_id, contact_id) do update set
      conversation_id = excluded.conversation_id,
      opportunity_id = excluded.opportunity_id,
      canal = excluded.canal,
      campana = excluded.campana,
      asesor_id = excluded.asesor_id,
      asignado_en = excluded.asignado_en,
      ingreso_en = excluded.ingreso_en,
      ingreso_anterior_a_carga = excluded.ingreso_anterior_a_carga,
      primera_resp_auto_en = excluded.primera_resp_auto_en,
      primera_resp_humana_en = excluded.primera_resp_humana_en,
      primera_resp_humana_por = excluded.primera_resp_humana_por,
      ultimo_inbound_en = excluded.ultimo_inbound_en,
      ultimo_outbound_en = excluded.ultimo_outbound_en,
      ultimo_humano_en = excluded.ultimo_humano_en,
      estado = excluded.estado,
      etapa_estandar = excluded.etapa_estandar,
      actualizado_en = now()
    returning l.contact_id`);

  // Eventos del lead (idempotentes por clave).
  await db.execute(sql`
    insert into comercial.eventos (clave, location_id, contact_id, conversation_id, opportunity_id, tipo, ocurrido_en, asesor_id, datos, fuente)
    select 'lead:' || location_id || ':' || contact_id, location_id, contact_id, conversation_id, opportunity_id,
      'lead_recibido', ingreso_en, asesor_id, jsonb_build_object('canal', canal, 'campana', campana), 'calculo'
    from comercial.leads
    where location_id = ${locationId} and ingreso_en is not null and not ingreso_anterior_a_carga ${filtro}
    on conflict (clave) do nothing`);
  await db.execute(sql`
    insert into comercial.eventos (clave, location_id, contact_id, conversation_id, tipo, ocurrido_en, asesor_id, fuente)
    select 'resp_auto:' || location_id || ':' || contact_id, location_id, contact_id, conversation_id,
      'primera_respuesta_auto', primera_resp_auto_en, asesor_id, 'calculo'
    from comercial.leads where location_id = ${locationId} and primera_resp_auto_en is not null ${filtro}
    on conflict (clave) do update set ocurrido_en = excluded.ocurrido_en, asesor_id = excluded.asesor_id`);
  await db.execute(sql`
    insert into comercial.eventos (clave, location_id, contact_id, conversation_id, tipo, ocurrido_en, asesor_id, datos, fuente)
    select 'resp_humana:' || location_id || ':' || contact_id, location_id, contact_id, conversation_id,
      'primera_respuesta_humana', primera_resp_humana_en, primera_resp_humana_por,
      jsonb_build_object('asesor_lead', asesor_id), 'calculo'
    from comercial.leads where location_id = ${locationId} and primera_resp_humana_en is not null ${filtro}
    on conflict (clave) do update set ocurrido_en = excluded.ocurrido_en, asesor_id = excluded.asesor_id`);
  return r.rows.length;
}
