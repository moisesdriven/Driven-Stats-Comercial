/**
 * Configuración de subcuentas (§10.2 pantalla 6): alta asistida con verificación de permisos del PIT,
 * mapa de etapas, etapas de calidad y estado de las cargas.
 */
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { ETAPAS_ESTANDAR } from '@driven/core';
import { cifrar, tablas, type Db } from '@driven/db';
import { ClienteGhl, ErrorGhl, Limitador, PERMISOS_GHL } from '@driven/ghl';
import { exigirModulo, exigirSubcuenta, type ContextoAcceso } from './acceso';
import { marcarRecalculo } from './horarios';
import { auditar } from './auditoria';
import { ErrorHttp, noEncontrado, solicitudInvalida } from './errores';

export const esquemaAltaSubcuenta = z.object({
  locationId: z.string().trim().min(5, 'Ingresa el ID de la subcuenta (locationId).').max(64),
  token: z.string().trim().min(10, 'Ingresa el token (PIT) de la subcuenta.').max(4000),
});

/**
 * Da de alta (o actualiza el token de) una subcuenta. Prueba cada permiso con una llamada mínima y,
 * si falta alguno, no guarda nada y dice cuál falta. El token se guarda cifrado; nunca se devuelve.
 */
export async function darDeAltaSubcuenta(
  db: Db,
  ctx: ContextoAcceso,
  entrada: z.infer<typeof esquemaAltaSubcuenta>,
  fetchGhl?: typeof fetch,
) {
  exigirModulo(ctx, 'configuracion', 'editar');
  const cliente = new ClienteGhl({
    token: entrada.token,
    locationId: entrada.locationId,
    reintentosMax: 1,
    limitador: new Limitador(20),
    ...(fetchGhl ? { fetch: fetchGhl, esperar: async () => {} } : {}),
  });
  const permisos = await cliente.verificarPermisos();
  const faltan = PERMISOS_GHL.filter((p) => !permisos[p].ok);
  if (faltan.length) {
    await auditar(db, ctx.usuarioId, 'token_rechazado', { locationId: entrada.locationId, faltan });
    throw new ErrorHttp(
      400,
      `Al token le faltan permisos: ${faltan.join(', ')}.`,
      'permisos_faltantes',
    );
  }
  let datos;
  try {
    datos = await cliente.subcuenta();
  } catch (e) {
    throw new ErrorHttp(
      400,
      e instanceof ErrorGhl
        ? `GHL respondió ${e.estado} al leer la subcuenta.`
        : 'No se pudo leer la subcuenta.',
      'ghl',
    );
  }
  const ahora = new Date();
  await db
    .insert(tablas.subcuentas)
    .values({
      locationId: entrada.locationId,
      nombre: datos.name,
      zonaHoraria: datos.timezone || 'America/Lima',
    })
    .onConflictDoUpdate({ target: tablas.subcuentas.locationId, set: { nombre: datos.name } });
  const credencial = {
    tokenCifrado: cifrar(entrada.token),
    permisosVerificados: permisos,
    verificadoEn: ahora,
  };
  await db
    .insert(tablas.credenciales)
    .values({ locationId: entrada.locationId, tipo: 'subcuenta', ...credencial })
    .onConflictDoUpdate({
      target: [tablas.credenciales.tipo, tablas.credenciales.locationId],
      set: credencial,
    });
  await auditar(db, ctx.usuarioId, 'token_alta', {
    locationId: entrada.locationId,
    nombre: datos.name,
  });
  return {
    locationId: entrada.locationId,
    nombre: datos.name,
    zonaHoraria: datos.timezone ?? null,
    permisos,
  };
}

/** Subcuentas con estado del token y de las últimas cargas (solo administración). */
export async function estadoSubcuentas(db: Db, ctx: ContextoAcceso) {
  exigirModulo(ctx, 'configuracion', 'ver');
  const [subs, creds, estados, ejecuciones] = await Promise.all([
    db.select().from(tablas.subcuentas).orderBy(tablas.subcuentas.nombre),
    db
      .select({
        locationId: tablas.credenciales.locationId,
        verificadoEn: tablas.credenciales.verificadoEn,
        permisos: tablas.credenciales.permisosVerificados,
      })
      .from(tablas.credenciales)
      .where(eq(tablas.credenciales.tipo, 'subcuenta')),
    db.select().from(tablas.syncEstado),
    db.execute<{
      location_id: string;
      tipo: string;
      estado: string;
      inicio: Date;
      fin: Date | null;
      llamadas: number;
      error: string | null;
    }>(sql`
      select distinct on (location_id, tipo) location_id, tipo, estado, inicio, fin, llamadas, error
      from comercial.sync_ejecuciones order by location_id, tipo, inicio desc`),
  ]);
  return subs.map((s) => ({
    locationId: s.locationId,
    nombre: s.nombre,
    zonaHoraria: s.zonaHoraria,
    activa: s.activa,
    etapasCalidad: s.etapasCalidad,
    token: creds.find((c) => c.locationId === s.locationId) ?? null,
    marcas: estados
      .filter((e) => e.locationId === s.locationId)
      .map((e) => ({
        recurso: e.recurso,
        marcaAgua: e.marcaAgua,
        ultimoOk: e.ultimoOk,
        ultimoError: e.ultimoError,
      })),
    ultimasCargas: ejecuciones.rows.filter((e) => e.location_id === s.locationId),
  }));
}

export async function etapasDeSubcuenta(db: Db, ctx: ContextoAcceso, locationId: string) {
  exigirSubcuenta(ctx, locationId);
  if (ctx.modulos.configuracion === 'ninguno') exigirModulo(ctx, 'metas', 'ver');
  const [sub] = await db
    .select()
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId))
    .limit(1);
  if (!sub) throw noEncontrado('Subcuenta no encontrada.');
  const etapas = await db
    .select()
    .from(tablas.mapaEtapas)
    .where(
      and(
        eq(tablas.mapaEtapas.locationId, locationId),
        inArray(tablas.mapaEtapas.locationId, ctx.subcuentas),
      ),
    );
  return { etapas, etapasCalidad: sub.etapasCalidad ?? [] };
}

export const esquemaMapaEtapas = z.object({
  etapas: z
    .array(
      z.object({ stageId: z.string().min(1), etapaEstandar: z.enum(ETAPAS_ESTANDAR).nullable() }),
    )
    .min(1),
});

/** Mapa de cada etapa real a una estándar. Las ventas pasadas se recalculan en la siguiente carga nocturna. */
export async function guardarMapaEtapas(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  entrada: z.infer<typeof esquemaMapaEtapas>,
) {
  exigirModulo(ctx, 'configuracion', 'editar');
  exigirSubcuenta(ctx, locationId);
  const existentes = await db
    .select()
    .from(tablas.mapaEtapas)
    .where(eq(tablas.mapaEtapas.locationId, locationId));
  const desconocidas = entrada.etapas.filter(
    (e) => !existentes.some((x) => x.stageId === e.stageId),
  );
  if (desconocidas.length)
    throw solicitudInvalida('Hay etapas que no pertenecen a esta subcuenta.');
  const cambios: Record<string, { antes: string | null; despues: string | null }> = {};
  for (const e of entrada.etapas) {
    const actual = existentes.find((x) => x.stageId === e.stageId)!;
    if (actual.etapaEstandar === e.etapaEstandar) continue;
    cambios[actual.nombreOriginal] = { antes: actual.etapaEstandar, despues: e.etapaEstandar };
    await db
      .update(tablas.mapaEtapas)
      .set({ etapaEstandar: e.etapaEstandar })
      .where(
        and(eq(tablas.mapaEtapas.locationId, locationId), eq(tablas.mapaEtapas.stageId, e.stageId)),
      );
  }
  if (Object.keys(cambios).length)
    await auditar(db, ctx.usuarioId, 'mapa_etapas', { locationId, cambios });
  return { cambios: Object.keys(cambios).length };
}

export const esquemaEtapasCalidad = z.object({
  etapas: z.array(z.string().min(1)).length(3, 'Elige exactamente 3 etapas.'),
});

/** Las 3 etapas de calidad de la subcuenta (§6.1). Aplica desde el siguiente análisis. */
export async function guardarEtapasCalidad(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  entrada: z.infer<typeof esquemaEtapasCalidad>,
) {
  exigirModulo(ctx, 'metas', 'editar');
  exigirSubcuenta(ctx, locationId);
  if (new Set(entrada.etapas).size !== 3)
    throw solicitudInvalida('Las 3 etapas deben ser distintas.');
  const existentes = await db
    .select({ stageId: tablas.mapaEtapas.stageId })
    .from(tablas.mapaEtapas)
    .where(
      and(
        eq(tablas.mapaEtapas.locationId, locationId),
        inArray(tablas.mapaEtapas.stageId, entrada.etapas),
      ),
    );
  if (existentes.length !== 3)
    throw solicitudInvalida('Hay etapas que no pertenecen a esta subcuenta.');
  const [antes] = await db
    .select({ e: tablas.subcuentas.etapasCalidad })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  await db
    .update(tablas.subcuentas)
    .set({ etapasCalidad: entrada.etapas })
    .where(eq(tablas.subcuentas.locationId, locationId));
  await auditar(db, ctx.usuarioId, 'etapas_calidad', {
    locationId,
    antes: antes?.e ?? null,
    despues: entrada.etapas,
  });
  return { ok: true };
}

/** Ejecuciones recientes de carga de una subcuenta. */
export async function cargasRecientes(db: Db, ctx: ContextoAcceso, locationId: string) {
  exigirModulo(ctx, 'configuracion', 'ver');
  exigirSubcuenta(ctx, locationId);
  return db
    .select()
    .from(tablas.syncEjecuciones)
    .where(eq(tablas.syncEjecuciones.locationId, locationId))
    .orderBy(desc(tablas.syncEjecuciones.inicio))
    .limit(30);
}

/** Zonas horarias que reconoce el entorno (IANA). */
const ZONAS_VALIDAS = new Set(Intl.supportedValuesOf('timeZone'));

export const esquemaZonaHoraria = z.object({
  zonaHoraria: z.string().refine((z) => ZONAS_VALIDAS.has(z), 'Zona horaria inválida.'),
});

/**
 * Cambia la zona horaria de la subcuenta. La carga desde GHL no la sobrescribe. Como cambia qué
 * hora cae en cada día, se recalcula todo el historial del resumen diario.
 */
export async function guardarZonaHoraria(
  db: Db,
  ctx: ContextoAcceso,
  locationId: string,
  e: z.infer<typeof esquemaZonaHoraria>,
) {
  exigirModulo(ctx, 'configuracion', 'editar');
  exigirSubcuenta(ctx, locationId);
  const [sub] = await db
    .select({ zona: tablas.subcuentas.zonaHoraria })
    .from(tablas.subcuentas)
    .where(eq(tablas.subcuentas.locationId, locationId));
  if (!sub) throw noEncontrado('Subcuenta no encontrada.');
  if (sub.zona === e.zonaHoraria) return { ok: true, recalculo: false };
  await db
    .update(tablas.subcuentas)
    .set({ zonaHoraria: e.zonaHoraria })
    .where(eq(tablas.subcuentas.locationId, locationId));
  const r = await db.execute<{ f: string | null }>(
    sql`select min(fecha)::text as f from comercial.resumen_diario where location_id = ${locationId}`,
  );
  await marcarRecalculo(db, locationId, r.rows[0]?.f ?? new Date().toISOString().slice(0, 10));
  await auditar(db, ctx.usuarioId, 'zona_horaria', {
    locationId,
    antes: sub.zona,
    despues: e.zonaHoraria,
  });
  return { ok: true, recalculo: true };
}
