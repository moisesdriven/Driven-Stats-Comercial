/**
 * calcular:resumen (§9): métricas de cada lead y `resumen_diario` por día × subcuenta × asesor
 * (asesor nulo = toda la subcuenta). Todos los tiempos en horario laboral del asesor atribuido.
 *
 * Atribución (§3 y decisiones del cliente):
 * - Tiempo de respuesta, sin responder, intentos y demás métricas del lead: el asesor del lead.
 * - Ventas, cancelaciones y pérdidas: el asesor de la oportunidad.
 * Las métricas por cohorte (tiempo de respuesta, intentos, respuesta efectiva, abandono, ventas de
 * la cohorte) se agrupan por día de ingreso del lead. Las fotos (sin responder, en espera,
 * seguimientos, interesados) son el estado al cierre de cada día (o ahora, para hoy).
 * Limitación: la etapa y el estado del lead usados en las fotos de días pasados son los actuales.
 */
import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import {
  HORARIO_CORRIDO,
  PATRON_MENSAJE_ENTRADA_SQL,
  UMBRALES_POR_DEFECTO,
  acumuladoVacio,
  calcularIndicadores,
  configuracionTiempo,
  diasLaborales,
  evaluar,
  fechaLocal,
  instanteLocal,
  metasDeSubcuenta,
  metricasLead,
  sumarAcumulados,
  type Acumulado,
  type Ausencia,
  type DatosLead,
  type MensajeLead,
  type Origen,
  type PeriodoEtapa,
  type TiempoAsesor,
  type Tramo,
  type Umbrales,
} from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { enLotes, log } from '../sync/util';

const SIN_ASESOR = '';
const VENTANA_FOTO_DIAS = 60;

function sumarDias(fecha: string, n: number): string {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

function finDelDia(fecha: string, zona: string): Date {
  const [a, m, d] = sumarDias(fecha, 1).split('-').map(Number) as [number, number, number];
  return new Date(instanteLocal(a, m, d, 0, 0, zona).getTime() - 1);
}

const hhmm = (v: string) => v.slice(0, 5);

export interface ResultadoResumen {
  dias: number;
  leads: number;
  filas: number;
  ms: number;
}

export async function calcularResumen(
  db: Db,
  locationId: string,
  p: { desde: string; hasta: string; ahora?: Date },
): Promise<ResultadoResumen> {
  const inicioMs = Date.now();
  const ahora = p.ahora ?? new Date();
  const [sub] = await db
    .select()
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId))
    .limit(1);
  if (!sub) throw new Error(`Subcuenta ${locationId} no existe.`);
  const zona = sub.zonaHoraria;
  const umbrales: Umbrales = {
    ...UMBRALES_POR_DEFECTO,
    ...((sub.umbrales as Partial<Umbrales>) ?? {}),
  };
  const metas = metasDeSubcuenta(sub.metas);

  // ---------------------------------------------------------------- Horarios y ausencias
  const filasHorario = await db
    .select()
    .from(tablas.horarios)
    .where(eq(tablas.horarios.locationId, locationId));
  const tramosPorAsesor = new Map<string, Tramo[]>();
  for (const h of filasHorario) {
    const clave = h.userId ?? SIN_ASESOR;
    const lista = tramosPorAsesor.get(clave) ?? [];
    lista.push({
      diaSemana: h.diaSemana,
      inicio: hhmm(h.horaInicio),
      fin: hhmm(h.horaFin),
      vigenteDesde: h.vigenteDesde,
      vigenteHasta: h.vigenteHasta,
    });
    tramosPorAsesor.set(clave, lista);
  }
  const filasAusencia = await db
    .select()
    .from(tablas.ausencias)
    .where(eq(tablas.ausencias.locationId, locationId));
  const feriados: Ausencia[] = filasAusencia
    .filter((a) => !a.userId)
    .map((a) => ({ inicio: a.inicio, fin: a.fin }));
  const tiempos = new Map<string, TiempoAsesor>();
  // Tiempo corrido (horarios variables): reloj de 24 horas, sin feriados ni ausencias.
  const corrido = configuracionTiempo(sub.horarioGeneral).modo === 'corrido';
  const tiempoDe = (asesor: string | null): TiempoAsesor => {
    const clave = asesor ?? SIN_ASESOR;
    let t = tiempos.get(clave);
    if (!t && corrido) {
      t = { horario: HORARIO_CORRIDO, ausencias: [], zona };
      tiempos.set(clave, t);
    }
    if (!t) {
      const propias = filasAusencia
        .filter((a) => a.userId && a.userId === asesor)
        .map((a) => ({ inicio: a.inicio, fin: a.fin }));
      t = {
        horario: tramosPorAsesor.get(clave) ?? tramosPorAsesor.get(SIN_ASESOR) ?? [],
        ausencias: [...feriados, ...propias],
        zona,
      };
      tiempos.set(clave, t);
    }
    return t;
  };

  // ---------------------------------------------------------------- Datos
  const desdeInstante = instanteLocal(
    ...(p.desde.split('-').map(Number) as [number, number, number]),
    0,
    0,
    zona,
  );
  const inicioDatos = new Date(desdeInstante.getTime() - VENTANA_FOTO_DIAS * 86_400_000);
  const hastaInstante = finDelDia(p.hasta, zona);

  const leads = await db
    .select()
    .from(tablas.leads)
    .where(
      and(
        eq(tablas.leads.locationId, locationId),
        isNotNull(tablas.leads.ingresoEn),
        eq(tablas.leads.ingresoAnteriorACarga, false),
        gte(tablas.leads.ingresoEn, inicioDatos),
        lte(tablas.leads.ingresoEn, hastaInstante),
      ),
    );
  const contactos = leads.map((l) => l.contactId);

  const mensajesPorContacto = new Map<string, MensajeLead[]>();
  for (const parte of enLotes(contactos, 2000)) {
    const filas = await db
      .select({
        contactId: tablas.mensajes.contactId,
        fecha: tablas.mensajes.fecha,
        direccion: tablas.mensajes.direccion,
        origen: tablas.mensajes.origen,
        // Mensaje de entrada al CRM ("Headline"): no se cuenta como mensaje del cliente.
        entrada: sql<boolean>`coalesce(${tablas.mensajes.texto}, '') ~* ${PATRON_MENSAJE_ENTRADA_SQL}`,
      })
      .from(tablas.mensajes)
      .where(
        and(
          eq(tablas.mensajes.locationId, locationId),
          inArray(tablas.mensajes.contactId, parte),
          gte(tablas.mensajes.fecha, inicioDatos),
        ),
      );
    for (const f of filas) {
      const lista = mensajesPorContacto.get(f.contactId!) ?? [];
      lista.push({
        fecha: f.fecha,
        direccion: f.direccion,
        origen: f.origen as Origen | null,
        entrada: f.direccion === 'inbound' && f.entrada,
      });
      mensajesPorContacto.set(f.contactId!, lista);
    }
  }
  for (const lista of mensajesPorContacto.values())
    lista.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  // Periodos en la etapa Nuevo: mientras el lead está ahí (lo atiende el workflow) no se mide.
  // La etapa estándar sale del mapa actual (las filas que vienen de actividades no la guardan).
  const filasNuevo = await db.execute<{ contact_id: string; desde: Date; hasta: Date | null }>(sql`
    select h.contact_id, h.desde, h.hasta
    from comercial.historial_etapas h
    left join comercial.mapa_etapas m on m.location_id = h.location_id and m.stage_id = h.stage_id
    where h.location_id = ${locationId} and h.contact_id is not null
      and coalesce(m.etapa_estandar, h.etapa_estandar) = 'nuevo'`);
  const nuevoPorContacto = new Map<string, PeriodoEtapa[]>();
  for (const f of filasNuevo.rows) {
    const lista = nuevoPorContacto.get(f.contact_id) ?? [];
    lista.push({ desde: new Date(f.desde), hasta: f.hasta ? new Date(f.hasta) : null });
    nuevoPorContacto.set(f.contact_id, lista);
  }

  const opps = await db
    .select()
    .from(tablas.oportunidades)
    .where(eq(tablas.oportunidades.locationId, locationId));
  const oppPorId = new Map(opps.map((o) => [o.opportunityId, o]));
  const tareas = await db
    .select()
    .from(tablas.tareas)
    .where(and(eq(tablas.tareas.locationId, locationId), eq(tablas.tareas.completada, false)));
  const tareasPorContacto = new Map<string, { venceEn: Date | null; completada: boolean }[]>();
  for (const t of tareas) {
    if (!t.contactId) continue;
    const lista = tareasPorContacto.get(t.contactId) ?? [];
    lista.push({ venceEn: t.venceEn, completada: t.completada });
    tareasPorContacto.set(t.contactId, lista);
  }

  const datosLead = (l: (typeof leads)[number]): DatosLead => {
    const opp = l.opportunityId ? oppPorId.get(l.opportunityId) : undefined;
    const ventaVigente = opp?.ventaEn && !opp.ventaCanceladaEn ? opp.ventaEn : null;
    return {
      ingresoEn: l.ingresoEn!,
      mensajes: mensajesPorContacto.get(l.contactId) ?? [],
      estado: (l.estado as DatosLead['estado']) ?? 'abierto',
      etapaEstandar: l.etapaEstandar,
      ventaEn: ventaVigente,
      tareas: tareasPorContacto.get(l.contactId) ?? [],
      periodosNuevo: nuevoPorContacto.get(l.contactId) ?? [],
    };
  };

  // ---------------------------------------------------------------- Acumulados por día y asesor
  const acumulados = new Map<string, Acumulado>(); // `${fecha}|${asesor}`
  const acc = (fecha: string, asesor: string | null) => {
    const k = `${fecha}|${asesor ?? SIN_ASESOR}`;
    let a = acumulados.get(k);
    if (!a) {
      a = acumuladoVacio();
      acumulados.set(k, a);
    }
    return a;
  };
  const dias: string[] = [];
  for (let d = p.desde; d <= p.hasta; d = sumarDias(d, 1)) dias.push(d);
  const enRango = (f: string) => f >= p.desde && f <= p.hasta;

  // Cohortes (por día de ingreso) y actualización de los campos derivados del lead.
  const actualizaciones: {
    contactId: string;
    minutos: number | null;
    intentos: number;
    efectiva: boolean;
    abandono: boolean;
  }[] = [];
  const metricasActuales = new Map<string, ReturnType<typeof metricasLead>>();
  for (const l of leads) {
    const t = tiempoDe(l.asesorId);
    const m = metricasLead(datosLead(l), t, umbrales, ahora);
    metricasActuales.set(l.contactId, m);
    actualizaciones.push({
      contactId: l.contactId,
      minutos: m.minutosRespuesta,
      intentos: m.intentos,
      efectiva: m.respuestaEfectiva,
      abandono: m.abandono,
    });
    // Respuestas: cada una cuenta el día en que escribió el cliente.
    for (const r of m.respuestasAsesor) {
      const diaR = fechaLocal(r.clienteEn, zona);
      if (enRango(diaR))
        acc(diaR, l.asesorId).tiemposRespuesta.push(Math.round(r.minutos * 100) / 100);
    }
    for (const f of m.ganadasIa) {
      const diaR = fechaLocal(f, zona);
      if (enRango(diaR)) acc(diaR, l.asesorId).respuestasIa++;
    }
    for (const f of m.respondidasWorkflow) {
      const diaR = fechaLocal(f, zona);
      if (enRango(diaR)) acc(diaR, l.asesorId).respuestasWorkflow++;
    }
    const dia = fechaLocal(l.ingresoEn!, zona);
    if (!enRango(dia)) continue;
    const a = acc(dia, l.asesorId);
    a.leadsRecibidos++;
    if (m.minutosRespuesta !== null) a.leadsConRespuesta++;
    if (m.respuestaEfectiva) a.respuestasEfectivas++;
    if (m.abandono) a.abandonos++;
    a.intentosTotal += m.intentos;
    a.intentosDistribucion[Math.min(m.intentos, 3)]!++;
    const opp = l.opportunityId ? oppPorId.get(l.opportunityId) : undefined;
    if (opp?.ventaEn && !opp.ventaCanceladaEn) a.ventasCohorte++;
  }

  // Ventas, cancelaciones y pérdidas (por día del evento, asesor de la oportunidad).
  const leadPorContacto = new Map(leads.map((l) => [l.contactId, l]));
  for (const o of opps) {
    if (o.ventaEn && !o.ventaCanceladaEn) {
      const dia = fechaLocal(o.ventaEn, zona);
      if (enRango(dia)) {
        const a = acc(dia, o.asesorId);
        a.ventas++;
        a.montoVentas += o.monto ?? 0;
        const l = o.contactId ? leadPorContacto.get(o.contactId) : undefined;
        if (l?.ingresoEn && l.ingresoEn <= o.ventaEn) {
          const t = tiempoDe(o.asesorId);
          a.sumaDiasCierre += diasLaborales(l.ingresoEn, o.ventaEn, t.horario, t.ausencias, t.zona);
          a.ventasConDiasCierre++;
        }
      }
    }
    if (o.ventaCanceladaEn) {
      const dia = fechaLocal(o.ventaCanceladaEn, zona);
      if (enRango(dia)) acc(dia, o.asesorId).ventasCanceladas++;
    }
    if (o.perdidaEn && (o.status === 'lost' || o.status === 'abandoned')) {
      const dia = fechaLocal(o.perdidaEn, zona);
      if (enRango(dia)) {
        const a = acc(dia, o.asesorId);
        a.perdidos++;
        const motivo = o.motivoPerdida ?? (o.status === 'abandoned' ? 'abandonada' : 'sin_motivo');
        a.perdidosPorMotivo[motivo] = (a.perdidosPorMotivo[motivo] ?? 0) + 1;
        const m = o.contactId ? metricasActuales.get(o.contactId) : undefined;
        if (m?.perdidoPorFaltaSeguimiento) a.perdidosFaltaSeguimiento++;
      }
    }
  }

  // Fotos al cierre de cada día.
  for (const dia of dias) {
    const corte = new Date(Math.min(finDelDia(dia, zona).getTime(), ahora.getTime()));
    if (corte < desdeInstante && dia !== p.desde) continue;
    const limiteIngreso = corte.getTime() - VENTANA_FOTO_DIAS * 86_400_000;
    for (const l of leads) {
      if (l.ingresoEn! > corte || l.ingresoEn!.getTime() < limiteIngreso) continue;
      const m = metricasLead(datosLead(l), tiempoDe(l.asesorId), umbrales, corte);
      if (!(
        m.sinResponder ||
        m.enEspera ||
        m.seguimientoVencido ||
        m.seguimientoProgramado ||
        m.interesadoDiasAnteriores
      ))
        continue;
      const a = acc(dia, l.asesorId);
      if (m.sinResponder) a.fotoSinResponder++;
      if (m.enEspera) a.fotoEnEspera++;
      if (m.seguimientoVencido) a.fotoSeguimientoVencido++;
      if (m.seguimientoProgramado) a.fotoSeguimientoProgramado++;
      if (m.interesadoDiasAnteriores) {
        a.fotoInteresadosAnteriores++;
        if (m.contactadoHoy) a.fotoInteresadosContactadosHoy++;
      }
    }
  }

  // ---------------------------------------------------------------- Guardar
  const filas: (typeof tablas.resumenDiario.$inferInsert)[] = [];
  for (const dia of dias) {
    const delDia = [...acumulados.entries()].filter(([k]) => k.startsWith(`${dia}|`));
    const total = sumarAcumulados(delDia.map(([, a]) => a));
    const fila = (asesorId: string | null, a: Acumulado) => {
      const ev = evaluar(calcularIndicadores(a, 1), metas, 1);
      return {
        fecha: dia,
        locationId,
        asesorId,
        indicadores: a,
        estadosEtapa: ev.etapas,
        cuelloBotella: ev.cuello,
        alertas: ev.alertas,
      };
    };
    filas.push(fila(null, total));
    for (const [k, a] of delDia) {
      const asesor = k.slice(dia.length + 1);
      if (asesor !== SIN_ASESOR) filas.push(fila(asesor, a));
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(tablas.resumenDiario)
      .where(
        and(
          eq(tablas.resumenDiario.locationId, locationId),
          gte(tablas.resumenDiario.fecha, p.desde),
          lte(tablas.resumenDiario.fecha, p.hasta),
        ),
      );
    for (const parte of enLotes(filas, 500))
      if (parte.length) await tx.insert(tablas.resumenDiario).values(parte);
  });

  for (const parte of enLotes(actualizaciones, 1000)) {
    if (!parte.length) continue;
    await db.execute(sql`
      update comercial.leads as l set
        minutos_laborales_respuesta = v.minutos::numeric,
        intentos = v.intentos::int,
        respuesta_efectiva = v.efectiva::boolean,
        abandono = v.abandono::boolean
      from (values ${sql.join(
        parte.map(
          (u) => sql`(${u.contactId}, ${u.minutos}, ${u.intentos}, ${u.efectiva}, ${u.abandono})`,
        ),
        sql`, `,
      )}) as v(contact_id, minutos, intentos, efectiva, abandono)
      where l.location_id = ${locationId} and l.contact_id = v.contact_id`);
  }

  const r = {
    dias: dias.length,
    leads: leads.length,
    filas: filas.length,
    ms: Date.now() - inicioMs,
  };
  log('resumen_ok', { locationId, desde: p.desde, hasta: p.hasta, ...r });
  return r;
}

/** Hoy en la zona de la subcuenta, "YYYY-MM-DD". */
export function hoyEn(zona: string, ahora = new Date()): string {
  return fechaLocal(ahora, zona);
}
export { sumarDias };
