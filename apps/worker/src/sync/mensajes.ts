/**
 * Carga de mensajes por rango de fechas (exportación de GHL) con el origen de cada saliente
 * (docs/mapeo-origen.md §3): para los salientes `app` se consulta a Conversation AI si los generó
 * el agente de IA. Un origen ya verificado no se vuelve a consultar.
 */
import { sql } from 'drizzle-orm';
import {
  canalDeTipo,
  clasificarOrigen,
  corteRetencionTexto,
  esActividad,
  esMensajeDeEntrada,
  requiereVerificarIa,
  tipoContenido,
  type ResultadoGeneracionIa,
} from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { esConversacionInexistente, type ClienteGhl, type MensajeGhl } from '@driven/ghl';
import { enLotes, enParalelo, lista, log } from './util';

export interface ResultadoMensajes {
  mensajes: number;
  /** Total informado por GHL para el rango (sin actividades). */
  totalGhl: number;
  verificadosIa: number;
  porOrigen: Record<string, number>;
  contactos: Set<string>;
  conversaciones: Set<string>;
  /** Conversaciones que GHL lista pero ya no existen (eliminadas o fusionadas): se saltan. */
  conversacionesInexistentes?: number;
}

async function asegurarParticiones(db: Db, desde: Date, hasta: Date) {
  const meses =
    (hasta.getUTCFullYear() - desde.getUTCFullYear()) * 12 +
    hasta.getUTCMonth() -
    desde.getUTCMonth() +
    2;
  await db.execute(
    sql`select comercial.asegurar_particiones_mensajes(${desde.toISOString().slice(0, 10)}::date, ${meses})`,
  );
}

/** Orígenes ya verificados en la base para evitar llamadas repetidas a GHL. */
async function origenesVerificados(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const r = await db.execute<{ message_id: string; origen: string }>(
    sql`select message_id, origen from comercial.mensajes where message_id in (${lista(ids)}) and origen_verificado_en is not null`,
  );
  return new Map(r.rows.map((f) => [f.message_id, f.origen]));
}

export async function guardarMensajes(
  db: Db,
  cliente: ClienteGhl,
  lote: MensajeGhl[],
  r: ResultadoMensajes,
  concurrenciaIa = 4,
) {
  const utiles = lote.filter((m) => !esActividad(m));
  const verificados = await origenesVerificados(
    db,
    utiles.map((m) => m.id),
  );
  const porVerificar = utiles.filter((m) => requiereVerificarIa(m) && !verificados.has(m.id));
  const generaciones = new Map<string, ResultadoGeneracionIa>();
  await enParalelo(porVerificar, concurrenciaIa, async (m) => {
    generaciones.set(m.id, await cliente.generacionIa(m.id));
  });
  r.verificadosIa += porVerificar.length;

  const ahora = new Date();
  // Un mensaje con más de 90 días se guarda sin texto (un Headline, solo con su marca): así una
  // recarga no deshace la purga.
  const corte = corteRetencionTexto(ahora).getTime();
  const filas = utiles.map((m) => {
    const yaVerificado = verificados.get(m.id);
    const gen = generaciones.get(m.id);
    const origen =
      (yaVerificado as ReturnType<typeof clasificarOrigen>) ?? clasificarOrigen(m, gen ?? null);
    const verificado =
      yaVerificado !== undefined ||
      (gen !== undefined && gen !== 'error') ||
      (origen !== null && origen !== 'sin_origen');
    if (origen) r.porOrigen[origen] = (r.porOrigen[origen] ?? 0) + 1;
    if (m.contactId) r.contactos.add(m.contactId);
    r.conversaciones.add(m.conversationId);
    return {
      messageId: m.id,
      locationId: cliente.locationId,
      conversationId: m.conversationId,
      contactId: m.contactId ?? null,
      direccion: m.direction,
      tipo: m.messageType ?? null,
      canal: canalDeTipo(m.messageType),
      contenido: tipoContenido(m),
      adjuntos: m.attachments?.length ?? 0,
      estado: m.status ?? null,
      source: m.source ?? null,
      origen,
      userId: m.userId ?? null,
      origenVerificadoEn: verificado && origen ? ahora : null,
      texto:
        Date.parse(m.dateAdded) < corte
          ? esMensajeDeEntrada(m.body)
            ? '*Headline*'
            : null
          : (m.body ?? null),
      fecha: new Date(m.dateAdded),
    };
  });

  for (const parte of enLotes(filas, 500)) {
    if (!parte.length) continue;
    await db
      .insert(tablas.mensajes)
      .values(parte)
      .onConflictDoUpdate({
        target: [tablas.mensajes.messageId, tablas.mensajes.fecha],
        set: {
          estado: sql`excluded.estado`,
          texto: sql`coalesce(${tablas.mensajes.texto}, excluded.texto)`,
          origen: sql`case when ${tablas.mensajes.origenVerificadoEn} is not null then ${tablas.mensajes.origen} else excluded.origen end`,
          origenVerificadoEn: sql`coalesce(${tablas.mensajes.origenVerificadoEn}, excluded.origen_verificado_en)`,
          userId: sql`excluded.user_id`,
        },
      });
  }
  r.mensajes += utiles.length;
}

export async function cargarMensajes(
  db: Db,
  cliente: ClienteGhl,
  desde: Date,
  hasta: Date,
  concurrenciaIa = 4,
  /** Fechas (ms) del último mensaje de cada conversación: prueba independiente de actividad. */
  ultimosMensajes: readonly number[] = [],
): Promise<ResultadoMensajes> {
  await asegurarParticiones(db, desde, hasta);
  const r: ResultadoMensajes = {
    mensajes: 0,
    totalGhl: 0,
    verificadosIa: 0,
    porOrigen: {},
    contactos: new Set(),
    conversaciones: new Set(),
  };
  const exportacion = cliente.exportarMensajes({
    desde,
    hasta,
    alTotal: (t) => (r.totalGhl = t),
  });
  for await (const lote of exportacion) {
    await guardarMensajes(db, cliente, lote, r, concurrenciaIa);
  }
  // Defensa: si GHL dice que el rango está vacío pero hay conversaciones cuyo último mensaje cae
  // dentro, la exportación falló (ocurrió con Jade18K el 16 nov 2026 durante varios minutos). Se
  // corta la carga antes de guardar la marca de avance; la siguiente ejecución reanuda este rango.
  if (r.totalGhl === 0 && r.mensajes === 0) {
    const conActividad = ultimosMensajes.filter(
      (t) => t >= desde.getTime() && t < hasta.getTime(),
    ).length;
    if (conActividad > 0) {
      log('exportacion_vacia_sospechosa', {
        locationId: cliente.locationId,
        desde: desde.toISOString(),
        hasta: hasta.toISOString(),
        conversacionesConActividad: conActividad,
      });
      throw new Error(
        `GHL respondió 0 mensajes de ${desde.toISOString()} a ${hasta.toISOString()}, pero ${conActividad} conversaciones tuvieron su último mensaje en ese rango. Se reintentará en la siguiente carga.`,
      );
    }
  }
  if (r.mensajes < r.totalGhl) {
    log('faltan_mensajes', {
      locationId: cliente.locationId,
      desde: desde.toISOString(),
      hasta: hasta.toISOString(),
      guardados: r.mensajes,
      totalGhl: r.totalGhl,
    });
  }
  return r;
}

/** Reintenta la verificación de salientes que quedaron `sin_origen` por un error (últimos N días). */
export async function reverificarSinOrigen(
  db: Db,
  cliente: ClienteGhl,
  dias = 7,
  ahora = new Date(),
): Promise<number> {
  // La ventana se calcula con `ahora` (no con el reloj de la base) para que sea reproducible.
  const desde = new Date(ahora.getTime() - dias * 86_400_000);
  const pendientes = await db.execute<{
    message_id: string;
    fecha: Date;
    user_id: string | null;
    source: string | null;
  }>(sql`
    select message_id, fecha, user_id, source from comercial.mensajes
    where location_id = ${cliente.locationId} and direccion = 'outbound' and origen = 'sin_origen'
      and origen_verificado_en is null and fecha > ${desde}
    limit 5000`);
  let actualizados = 0;
  await enParalelo(pendientes.rows, 4, async (m) => {
    const gen = await cliente.generacionIa(m.message_id);
    if (gen === 'error') return;
    const origen = clasificarOrigen(
      { direction: 'outbound', source: m.source, userId: m.user_id },
      gen,
    );
    await db
      .update(tablas.mensajes)
      .set({ origen, origenVerificadoEn: new Date() })
      .where(
        sql`${tablas.mensajes.messageId} = ${m.message_id} and ${tablas.mensajes.fecha} = ${m.fecha}`,
      );
    actualizados++;
  });
  return actualizados;
}

/**
 * Complemento en tiempo real de la exportación. La exportación de GHL puede ir horas atrasada (el
 * 17 nov 2026 llevaba unas 3 h: las respuestas de la tarde no salían), pero la consulta por
 * conversación entrega los mensajes al instante. Para cada conversación con actividad trae sus
 * mensajes desde `desde` (vienen del más reciente al más antiguo). Se guardan con el mismo upsert
 * idempotente: si después llegan por la exportación, no se duplican.
 */
export async function cargarMensajesRecientes(
  db: Db,
  cliente: ClienteGhl,
  conversaciones: readonly string[],
  desde: Date,
  hasta: Date,
  concurrencia = 4,
): Promise<ResultadoMensajes> {
  const r: ResultadoMensajes = {
    mensajes: 0,
    totalGhl: 0,
    verificadosIa: 0,
    porOrigen: {},
    contactos: new Set(),
    conversaciones: new Set(),
  };
  if (!conversaciones.length) return r;
  await asegurarParticiones(db, desde, hasta);
  const limite = desde.getTime();
  await enParalelo([...conversaciones], concurrencia, async (id) => {
    try {
      for await (const lote of cliente.mensajesConversacion(id)) {
        const dentro = lote.filter((m) => {
          const t = Date.parse(m.dateAdded);
          return t >= limite && t <= hasta.getTime();
        });
        if (dentro.length) await guardarMensajes(db, cliente, dentro, r, 1);
        // Más antiguo que `desde` en esta página: ya no hay nada nuevo más atrás.
        if (lote.some((m) => Date.parse(m.dateAdded) < limite)) return;
      }
    } catch (e) {
      // Eliminada o fusionada en GHL: no hay mensajes que traer; se sigue con las demás.
      if (!esConversacionInexistente(e)) throw e;
      r.conversacionesInexistentes = (r.conversacionesInexistentes ?? 0) + 1;
    }
  });
  return r;
}
