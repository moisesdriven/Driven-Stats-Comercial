/**
 * Orquestación de las cargas (ESPECIFICACION.md §7 y §9):
 * - incremental (cada 15 min): conversaciones y mensajes desde la marca de agua, oportunidades de los
 *   contactos tocados, ventas y leads.
 * - nocturna: catálogos, reconciliación completa de oportunidades, tareas, reverificación de
 *   orígenes pendientes y recálculo de todos los leads.
 * - histórica (manual): N días por tramos diarios (se puede reanudar), historial de etapas desde las
 *   actividades, oportunidades, tareas y leads.
 * Todas las escrituras son upsert idempotentes por id de GHL.
 */
import { and, eq, sql } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import type { ClienteGhl } from '@driven/ghl';
import { calcularResumen, hoyEn, sumarDias } from '../calculo/resumen';
import { sincronizarCatalogos } from './catalogos';
import { cargarConversaciones } from './conversaciones';
import { recalcularLeads } from './leads';
import { cargarMensajes, reverificarSinOrigen, type ResultadoMensajes } from './mensajes';
import { cargarOportunidades, reconstruirHistorial, recalcularVentas } from './oportunidades';
import { cargarTareas } from './tareas';
import { log } from './util';

async function zonaSubcuenta(db: Db, locationId: string): Promise<string> {
  const [s] = await db
    .select({ z: tablas.subcuentas.zonaHoraria })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId))
    .limit(1);
  return s?.z ?? 'America/Lima';
}

async function hoySubcuenta(db: Db, locationId: string, ahora: Date): Promise<string> {
  return hoyEn(await zonaSubcuenta(db, locationId), ahora);
}

export type TipoCarga = 'incremental' | 'nocturno' | 'historico';

async function leerMarca(db: Db, locationId: string, recurso: string): Promise<Date | null> {
  const [f] = await db
    .select()
    .from(tablas.syncEstado)
    .where(
      and(eq(tablas.syncEstado.locationId, locationId), eq(tablas.syncEstado.recurso, recurso)),
    )
    .limit(1);
  return f?.marcaAgua ?? null;
}

/** Borra la marca de avance (p. ej. al terminar una carga histórica). */
async function limpiarMarca(db: Db, locationId: string, recurso: string) {
  await db
    .update(tablas.syncEstado)
    .set({ marcaAgua: null, ultimoOk: new Date(), ultimoError: null })
    .where(
      and(eq(tablas.syncEstado.locationId, locationId), eq(tablas.syncEstado.recurso, recurso)),
    );
}

async function guardarMarca(
  db: Db,
  locationId: string,
  recurso: string,
  marca: Date | null,
  error?: string,
) {
  const ahora = new Date();
  const fila = {
    locationId,
    recurso,
    ...(marca ? { marcaAgua: marca } : {}),
    ...(error ? { ultimoError: error.slice(0, 500) } : { ultimoOk: ahora, ultimoError: null }),
  };
  await db
    .insert(tablas.syncEstado)
    .values(fila)
    .onConflictDoUpdate({
      target: [tablas.syncEstado.locationId, tablas.syncEstado.recurso],
      set: fila,
    });
}

const resumenMensajes = (r: ResultadoMensajes) => ({
  mensajes: r.mensajes,
  totalGhl: r.totalGhl,
  verificadosIa: r.verificadosIa,
  porOrigen: r.porOrigen,
  contactos: r.contactos.size,
});

export interface OpcionesCarga {
  dias?: number;
  modo: 'sombra' | 'activo';
  /** Solo pruebas: fecha "ahora". */
  ahora?: Date;
}

export async function ejecutarCarga(
  db: Db,
  cliente: ClienteGhl,
  tipo: TipoCarga,
  o: OpcionesCarga,
): Promise<Record<string, unknown>> {
  const loc = cliente.locationId;
  const ahora = o.ahora ?? new Date();
  const [ejecucion] = await db
    .insert(tablas.syncEjecuciones)
    .values({ locationId: loc, tipo, modo: o.modo, estado: 'en_curso' })
    .returning({ id: tablas.syncEjecuciones.id });
  const resumen: Record<string, unknown> = {};
  const llamadasInicio = cliente.llamadas;
  log('carga_inicio', { locationId: loc, tipo });
  try {
    if (tipo === 'incremental') {
      const marca =
        (await leerMarca(db, loc, 'mensajes')) ?? new Date(ahora.getTime() - 24 * 3600_000);
      const desde = new Date(marca.getTime() - 10 * 60_000); // solape de 10 min por mensajes tardíos
      resumen.catalogos = await sincronizarCatalogos(db, cliente);
      const conv = await cargarConversaciones(db, cliente, desde);
      const men = await cargarMensajes(db, cliente, desde, ahora, 4, conv.ultimosMensajes);
      const contactos = [...new Set([...men.contactos, ...conv.contactos])];
      const opp = await cargarOportunidades(db, cliente, { contactIds: contactos });
      resumen.conversaciones = conv.conversaciones;
      resumen.mensajes = resumenMensajes(men);
      resumen.oportunidades = {
        leidas: opp.oportunidades,
        nuevas: opp.nuevas,
        cambiosEtapa: opp.cambiosEtapa,
      };
      resumen.ventas = await recalcularVentas(db, loc, [...opp.ids]);
      resumen.leads = await recalcularLeads(db, loc, contactos);
      await guardarMarca(db, loc, 'mensajes', ahora);
      const hoy = await hoySubcuenta(db, loc, ahora);
      resumen.resumen = await calcularResumen(db, loc, {
        desde: sumarDias(hoy, -1),
        hasta: hoy,
        ahora,
      });
    } else if (tipo === 'nocturno') {
      resumen.catalogos = await sincronizarCatalogos(db, cliente);
      const opp = await cargarOportunidades(db, cliente);
      resumen.oportunidades = {
        leidas: opp.oportunidades,
        nuevas: opp.nuevas,
        cambiosEtapa: opp.cambiosEtapa,
      };
      resumen.ventas = await recalcularVentas(db, loc);
      resumen.tareas = await cargarTareas(db, cliente);
      resumen.reverificados = await reverificarSinOrigen(db, cliente);
      resumen.leads = await recalcularLeads(db, loc);
      await guardarMarca(db, loc, 'nocturno', ahora);
      const hoy = await hoySubcuenta(db, loc, ahora);
      resumen.resumen = await calcularResumen(db, loc, {
        desde: sumarDias(hoy, -3),
        hasta: hoy,
        ahora,
      });
    } else {
      const dias = o.dias ?? 90;
      const inicio = new Date(ahora.getTime() - dias * 86_400_000);
      // Reanudable: si una carga histórica anterior se cortó, sigue desde el último día completo.
      const avance = await leerMarca(db, loc, 'historico');
      let desde = avance && avance > inicio && avance < ahora ? avance : inicio;
      resumen.catalogos = await sincronizarCatalogos(db, cliente);
      const conv = await cargarConversaciones(db, cliente, inicio);
      resumen.conversaciones = conv.conversaciones;
      const total: ResultadoMensajes = {
        mensajes: 0,
        totalGhl: 0,
        verificadosIa: 0,
        porOrigen: {},
        contactos: new Set(),
        conversaciones: new Set(),
      };
      while (desde < ahora) {
        const hasta = new Date(Math.min(desde.getTime() + 86_400_000, ahora.getTime()));
        const r = await cargarMensajes(db, cliente, desde, hasta, 4, conv.ultimosMensajes);
        total.mensajes += r.mensajes;
        total.totalGhl += r.totalGhl;
        total.verificadosIa += r.verificadosIa;
        for (const [k, v] of Object.entries(r.porOrigen))
          total.porOrigen[k] = (total.porOrigen[k] ?? 0) + v;
        await guardarMarca(db, loc, 'historico', hasta);
        log('historico_dia', {
          locationId: loc,
          desde: desde.toISOString(),
          hasta: hasta.toISOString(),
          mensajes: r.mensajes,
          totalGhl: r.totalGhl,
          llamadas: cliente.llamadas - llamadasInicio,
        });
        desde = hasta;
      }
      resumen.mensajes = {
        mensajes: total.mensajes,
        totalGhl: total.totalGhl,
        verificadosIa: total.verificadosIa,
        porOrigen: total.porOrigen,
      };
      resumen.historial = await reconstruirHistorial(
        db,
        cliente,
        conv.ids,
        await cliente.pipelines(),
      );
      const opp = await cargarOportunidades(db, cliente);
      resumen.oportunidades = {
        leidas: opp.oportunidades,
        nuevas: opp.nuevas,
        cambiosEtapa: opp.cambiosEtapa,
      };
      resumen.ventas = await recalcularVentas(db, loc);
      resumen.tareas = await cargarTareas(db, cliente);
      resumen.leads = await recalcularLeads(db, loc);
      if (!(await leerMarca(db, loc, 'mensajes'))) await guardarMarca(db, loc, 'mensajes', ahora);
      await limpiarMarca(db, loc, 'historico');
      const hoy = await hoySubcuenta(db, loc, ahora);
      resumen.resumen = await calcularResumen(db, loc, {
        desde: hoyEn(await zonaSubcuenta(db, loc), inicio),
        hasta: hoy,
        ahora,
      });
    }
    const llamadas = cliente.llamadas - llamadasInicio;
    await db
      .update(tablas.syncEjecuciones)
      .set({ fin: new Date(), estado: 'ok', llamadas, resumen })
      .where(eq(tablas.syncEjecuciones.id, ejecucion!.id));
    log('carga_ok', { locationId: loc, tipo, llamadas, resumen });
    return { ...resumen, llamadas };
  } catch (e) {
    const mensaje = e instanceof Error ? e.message : String(e);
    await db
      .update(tablas.syncEjecuciones)
      .set({
        fin: new Date(),
        estado: 'error',
        llamadas: cliente.llamadas - llamadasInicio,
        resumen,
        error: mensaje.slice(0, 1000),
      })
      .where(eq(tablas.syncEjecuciones.id, ejecucion!.id));
    await guardarMarca(db, loc, tipo, null, mensaje);
    log('carga_error', { locationId: loc, tipo, error: mensaje });
    throw e;
  } finally {
    await db.execute(sql`select 1`);
  }
}
