/**
 * Listas para actuar de una subcuenta (§10.2): sin responder, pendientes de seguimiento e
 * interesados de días anteriores sin contacto hoy. Se calculan en vivo, en tiempo laboral del
 * asesor de cada lead. Los leads perdidos no aparecen (decisión del cliente).
 * Sin responder (reglas del 16 y 17 nov 2026): un mensaje del cliente que no respondió nadie (ni el
 * asesor, ni el agente IA, ni un workflow), sin contar los mensajes de entrada ("Headline") ni la
 * etapa Nuevo, que lleva 15 min o más con el asesor en turno. Si el asesor lleva más de 3 h sin
 * escribir a ningún cliente está fuera de turno: el pendiente se muestra aparte y no es falta.
 */
import { sql } from 'drizzle-orm';
import {
  crearJornadas,
  diasLaborales,
  inicioDelDia,
  PATRON_MENSAJE_ENTRADA_SQL,
} from '@driven/core';
import type { Db } from '@driven/db';
import { exigirModulo, exigirSubcuenta, type ContextoAcceso } from '../acceso';
import { tiemposSubcuenta } from './tiempo';

export interface FilaAccion {
  conversationId: string | null;
  contacto: string;
  canal: string | null;
  mensaje: string | null;
  asesor: string | null;
  espera: string;
  /** Minutos laborales de espera (para ordenar y colorear). */
  minutos: number;
  urgente: boolean;
  enlace: string | null;
}

const ETIQUETA_ETAPA: Record<string, string> = {
  interesado: 'Interesado',
  por_cerrar: 'Por cerrar',
};

export function enlaceGhl(locationId: string, conversationId: string | null): string | null {
  if (!conversationId) return null;
  const base = (process.env.GHL_URL_APP || 'https://app.gohighlevel.com').replace(/\/$/, '');
  return `${base}/v2/location/${encodeURIComponent(locationId)}/conversations/conversations/${encodeURIComponent(conversationId)}`;
}

const contacto = (id: string) => `Contacto ···${id.slice(-4)}`;

function esperaTexto(min: number): string {
  if (min < 60) return `${Math.max(0, Math.round(min))} min`;
  if (min < 24 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.max(1, Math.round(min / 1440))} días`;
}

export async function listasParaActuar(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  ahora = new Date(),
) {
  exigirModulo(ctx, 'vista_subcuenta');
  exigirSubcuenta(ctx, locationId);
  const verTextos = ctx.modulos.texto_mensajes !== 'ninguno';
  const [sub] = (
    await db.execute<{ zona_horaria: string }>(
      sql`select zona_horaria from comercial.subcuentas where location_id = ${locationId}`,
    )
  ).rows;
  const zona = sub?.zona_horaria ?? 'America/Lima';
  const tiempo = await tiemposSubcuenta(db, locationId, zona);
  const r = await db.execute<{
    contact_id: string;
    conversation_id: string | null;
    canal: string | null;
    asesor_id: string | null;
    asesor: string | null;
    ingreso_en: Date;
    primera_resp_humana_en: Date | null;
    ultimo_humano_en: Date | null;
    ultimo_inbound_en: Date | null;
    estado: string | null;
    etapa_estandar: string | null;
    ultimo_texto: string | null;
    tarea_vencida: boolean;
    pendiente_desde: Date | null;
  }>(sql`
    with ultima_respuesta as (
      select m.contact_id, max(m.fecha) as fecha from comercial.mensajes m
      where m.location_id = ${locationId} and m.direccion = 'outbound' and m.origen in ('manual', 'agente_ia', 'workflow')
        and m.fecha > ${new Date(ahora.getTime() - 61 * 86_400_000)}
      group by m.contact_id
    ),
    pendiente as (
      select m.contact_id, min(m.fecha) as desde from comercial.mensajes m
      left join ultima_respuesta r on r.contact_id = m.contact_id
      where m.location_id = ${locationId} and m.direccion = 'inbound'
        and m.fecha > ${new Date(ahora.getTime() - 61 * 86_400_000)}
        and (r.fecha is null or m.fecha > r.fecha)
        and coalesce(m.texto, '') !~* ${PATRON_MENSAJE_ENTRADA_SQL}
        and not exists (
          select 1 from comercial.historial_etapas h
          left join comercial.mapa_etapas e on e.location_id = h.location_id and e.stage_id = h.stage_id
          where h.location_id = m.location_id and h.contact_id = m.contact_id
            and coalesce(e.etapa_estandar, h.etapa_estandar) = 'nuevo'
            and m.fecha >= h.desde and (h.hasta is null or m.fecha < h.hasta))
      group by m.contact_id
    )
    select l.contact_id, l.conversation_id, l.canal, l.asesor_id, a.nombre as asesor, l.ingreso_en,
      l.primera_resp_humana_en, l.ultimo_humano_en, l.ultimo_inbound_en, l.estado, l.etapa_estandar,
      p.desde as pendiente_desde,
      -- Una imagen, audio o video sin texto se muestra con su tipo: también es un mensaje que responder.
      (select coalesce(nullif(m.texto, ''), case when m.contenido in ('imagen', 'audio', 'video')
          then '(' || m.contenido || ')' end) from comercial.mensajes m
        where m.location_id = l.location_id and m.contact_id = l.contact_id and m.direccion = 'inbound'
          and coalesce(m.texto, '') !~* ${PATRON_MENSAJE_ENTRADA_SQL}
        order by m.fecha desc limit 1) as ultimo_texto,
      exists (select 1 from comercial.tareas t where t.location_id = l.location_id and t.contact_id = l.contact_id
        and not t.completada and t.vence_en < ${ahora}) as tarea_vencida
    from comercial.leads l
    left join comercial.asesores a on a.user_id = l.asesor_id
    left join pendiente p on p.contact_id = l.contact_id
    where l.location_id = ${locationId} and l.location_id in (${sql.join(
      ctx.subcuentas.map((x) => sql`${x}`),
      sql`, `,
    )})
      and l.ingreso_en is not null and not l.ingreso_anterior_a_carga
      and coalesce(l.estado, 'abierto') <> 'perdido'
      and l.ingreso_en > ${new Date(ahora.getTime() - 60 * 86_400_000)}
      and ((p.desde is not null and coalesce(l.etapa_estandar, '') <> 'nuevo')
        or l.etapa_estandar in ('interesado', 'por_cerrar'))`);

  // Turno real de cada asesor: sus salientes manuales de los últimos 60 días a cualquier cliente.
  // json_agg (no array_agg): el driver entrega los arreglos de fechas como texto, no como lista.
  const actividad = await db.execute<{ user_id: string; fechas: string[] }>(sql`
    select user_id, json_agg(fecha order by fecha) as fechas from comercial.mensajes
    where location_id = ${locationId} and direccion = 'outbound' and origen = 'manual'
      and user_id is not null and fecha > ${new Date(ahora.getTime() - 61 * 86_400_000)} and fecha <= ${ahora}
    group by user_id`);
  const jornadas = crearJornadas(
    new Map(actividad.rows.map((f) => [f.user_id, f.fechas.map((x) => new Date(x))])),
  );

  const hoy = inicioDelDia(ahora, zona);
  const sinResponder: FilaAccion[] = [];
  const fueraDeTurno: FilaAccion[] = [];
  const pendientes: FilaAccion[] = [];
  const interesados: FilaAccion[] = [];
  for (const f of r.rows) {
    const t = tiempo(f.asesor_id);
    const base = {
      conversationId: f.conversation_id,
      contacto: contacto(f.contact_id),
      canal: f.canal,
      asesor: f.asesor,
      enlace: enlaceGhl(locationId, f.conversation_id),
    };
    const textoCliente = verTextos ? (f.ultimo_texto?.slice(0, 140) ?? '(sin texto)') : null;
    if (f.pendiente_desde && f.etapa_estandar !== 'nuevo') {
      const inicio = jornadas.inicio(f.asesor_id, new Date(f.pendiente_desde));
      const min = Math.max(0, (ahora.getTime() - inicio.getTime()) / 60_000);
      if (!jornadas.enTurno(f.asesor_id, ahora)) {
        fueraDeTurno.push({
          ...base,
          mensaje: textoCliente,
          espera: 'Asesor fuera de turno',
          minutos: min,
          urgente: false,
        });
      } else if (min >= 15) {
        sinResponder.push({
          ...base,
          mensaje: textoCliente,
          espera: esperaTexto(min),
          minutos: min,
          urgente: min >= 60,
        });
      }
      if (f.etapa_estandar !== 'interesado' && f.etapa_estandar !== 'por_cerrar') continue;
    }
    if (f.estado !== 'abierto' && f.estado !== null) continue;
    const etapa = ETIQUETA_ETAPA[f.etapa_estandar ?? ''] ?? '';
    const referencia = new Date(f.ultimo_humano_en ?? f.ingreso_en);
    const diasSin = diasLaborales(referencia, ahora, t.horario, t.ausencias, t.zona);
    if (diasSin > 1 || f.tarea_vencida) {
      pendientes.push({
        ...base,
        mensaje: `Etapa: ${etapa}${f.tarea_vencida ? ' · tarea vencida' : ''}`,
        espera: `${Math.max(1, Math.floor(diasSin))} ${Math.floor(diasSin) <= 1 ? 'día lab.' : 'días lab.'}`,
        minutos: diasSin * 480,
        urgente: diasSin >= 2,
      });
    }
    const contactoAntes = [f.ultimo_humano_en, f.ultimo_inbound_en].some(
      (x) => x && new Date(x) < hoy,
    );
    const contactadoHoy = f.ultimo_humano_en && new Date(f.ultimo_humano_en) >= hoy;
    if (new Date(f.ingreso_en) < hoy && contactoAntes && !contactadoHoy) {
      interesados.push({
        ...base,
        mensaje: `${etapa} · último contacto antes de hoy`,
        espera: 'Sin contacto hoy',
        minutos: diasSin * 480,
        urgente: false,
      });
    }
  }
  const orden = (a: FilaAccion, b: FilaAccion) => b.minutos - a.minutos;
  return {
    // Sin responder: los más recientes primero (son los que aún se pueden recuperar).
    // Las faltas primero (más recientes arriba); al final, los pendientes con el asesor fuera de turno.
    sinResponder: [
      ...sinResponder.sort((a, b) => a.minutos - b.minutos),
      ...fueraDeTurno.sort((a, b) => a.minutos - b.minutos),
    ].slice(0, 100),
    pendientes: pendientes.sort(orden).slice(0, 100),
    interesados: interesados.sort(orden).slice(0, 100),
    totales: {
      sinResponder: sinResponder.length,
      fueraDeTurno: fueraDeTurno.length,
      pendientes: pendientes.length,
      interesados: interesados.length,
    },
  };
}
