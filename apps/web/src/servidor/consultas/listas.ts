/**
 * Listas para actuar de una subcuenta (§10.2): sin responder, pendientes de seguimiento e
 * interesados de días anteriores sin contacto hoy. Se calculan en vivo, en tiempo laboral del
 * asesor de cada lead. Los leads perdidos no aparecen (decisión del cliente).
 */
import { sql } from 'drizzle-orm';
import { diasLaborales, inicioDelDia, minutosLaborales } from '@driven/core';
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
  if (min < 8 * 60) return `${Math.round(min / 60)} h lab.`;
  return `${Math.max(1, Math.round(min / 480))} días lab.`;
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
  }>(sql`
    select l.contact_id, l.conversation_id, l.canal, l.asesor_id, a.nombre as asesor, l.ingreso_en,
      l.primera_resp_humana_en, l.ultimo_humano_en, l.ultimo_inbound_en, l.estado, l.etapa_estandar,
      (select m.texto from comercial.mensajes m
        where m.location_id = l.location_id and m.contact_id = l.contact_id and m.direccion = 'inbound'
        order by m.fecha desc limit 1) as ultimo_texto,
      exists (select 1 from comercial.tareas t where t.location_id = l.location_id and t.contact_id = l.contact_id
        and not t.completada and t.vence_en < ${ahora}) as tarea_vencida
    from comercial.leads l
    left join comercial.asesores a on a.user_id = l.asesor_id
    where l.location_id = ${locationId} and l.location_id in (${sql.join(
      ctx.subcuentas.map((x) => sql`${x}`),
      sql`, `,
    )})
      and l.ingreso_en is not null and not l.ingreso_anterior_a_carga
      and coalesce(l.estado, 'abierto') <> 'perdido'
      and l.ingreso_en > ${new Date(ahora.getTime() - 60 * 86_400_000)}
      and (l.primera_resp_humana_en is null or l.etapa_estandar in ('interesado', 'por_cerrar'))`);

  const hoy = inicioDelDia(ahora, zona);
  const sinResponder: FilaAccion[] = [];
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
    if (!f.primera_resp_humana_en) {
      const min = minutosLaborales(new Date(f.ingreso_en), ahora, t.horario, t.ausencias, t.zona);
      sinResponder.push({
        ...base,
        mensaje: textoCliente,
        espera: esperaTexto(min),
        minutos: min,
        urgente: min > 15,
      });
      continue;
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
    sinResponder: sinResponder.sort((a, b) => a.minutos - b.minutos).slice(0, 100),
    pendientes: pendientes.sort(orden).slice(0, 100),
    interesados: interesados.sort(orden).slice(0, 100),
    totales: {
      sinResponder: sinResponder.length,
      pendientes: pendientes.length,
      interesados: interesados.length,
    },
  };
}
