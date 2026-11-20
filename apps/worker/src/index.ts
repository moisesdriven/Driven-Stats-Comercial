/**
 * Worker de Driven Comercial: cargas desde GHL con pg-boss (esquema `comercial_cola`).
 *   sync-incremental  cada SYNC_INCREMENTAL_MINUTOS (15 por defecto)
 *   sync-nocturno     diario a SYNC_NOCTURNO_HORA, hora de Lima (02:30 por defecto)
 *   sync-historico    la primera carga de cada subcuenta (los 90 días anteriores, hoy incluido):
 *                     se encola sola cuando la subcuenta aún no la tiene; a mano también con
 *                     node dist/cli.js historico --dias 90 [--subcuenta <locationId>]
 *   resumen-pendiente cada 5 min: recalcula el resumen diario de las subcuentas marcadas desde la web
 *   purga-textos      diario a las 03:30: borra el texto de los mensajes con más de 90 días
 * Una sola ejecución activa por cola (política singleton). Modo `sombra` por defecto.
 */
import { PgBoss } from 'pg-boss';
import { configuracionCalidadVigente, crearConexion, ESQUEMA_COLA, tablas } from '@driven/db';
import { recalcularPendientes } from './calculo/pendientes';
import { purgarTextos } from './mantenimiento/purga';
import { procesarPendientes, solicitarAnalisis } from './calidad/proceso';
import { ProveedorAnthropic } from './calidad/proveedor';
import { leerConfiguracion } from './configuracion';
import { subcuentasActivas } from './subcuentas';
import {
  DIAS_HISTORICO,
  ejecutarCarga,
  marcarHistoricoSolicitado,
  necesitaHistoricoInicial,
  type TipoCarga,
} from './sync/ejecutar';
import { log } from './sync/util';

export const COLAS: Record<TipoCarga, string> = {
  incremental: 'sync-incremental',
  nocturno: 'sync-nocturno',
  historico: 'sync-historico',
};

export interface DatosTrabajo {
  subcuenta?: string;
  dias?: number;
}

async function principal() {
  const cfg = leerConfiguracion();
  const { db, pool } = crearConexion(cfg.DATABASE_URL_WORKER, 8);
  const boss = new PgBoss({
    connectionString: cfg.DATABASE_URL_WORKER,
    schema: ESQUEMA_COLA,
    max: 4,
  });
  boss.on('error', (e) =>
    log('pgboss_error', { error: e instanceof Error ? e.message : String(e) }),
  );
  await boss.start();

  for (const cola of Object.values(COLAS)) {
    await boss.createQueue(cola, {
      policy: 'singleton',
      retryLimit: 1,
      retryDelay: 60,
      expireInSeconds: 6 * 3600,
    });
  }
  const [hora, minuto] = cfg.SYNC_NOCTURNO_HORA.split(':').map(Number);
  await boss.schedule(
    COLAS.incremental,
    `*/${cfg.SYNC_INCREMENTAL_MINUTOS} * * * *`,
    {},
    { tz: cfg.ZONA_HORARIA_DEFECTO },
  );
  await boss.schedule(
    COLAS.nocturno,
    `${minuto} ${hora} * * *`,
    {},
    { tz: cfg.ZONA_HORARIA_DEFECTO },
  );

  for (const [tipo, cola] of Object.entries(COLAS) as [TipoCarga, string][]) {
    await boss.work<DatosTrabajo>(cola, async (trabajos) => {
      for (const t of trabajos) {
        const subcuentas = await subcuentasActivas(db, cfg.GHL_MAX_LLAMADAS_10S, t.data?.subcuenta);
        for (const s of subcuentas) {
          // Primera carga de una subcuenta (recién agregada o que nunca tuvo la histórica): los 90
          // días anteriores, hoy incluido, en su propia cola. La incremental sigue mientras tanto.
          if (tipo === 'incremental') {
            const loc = s.cliente.locationId;
            try {
              if (await necesitaHistoricoInicial(db, loc)) {
                await boss.send(COLAS.historico, { subcuenta: loc, dias: DIAS_HISTORICO });
                await marcarHistoricoSolicitado(db, loc);
                log('historico_inicial_encolado', { locationId: loc, dias: DIAS_HISTORICO });
              }
            } catch (e) {
              log('historico_inicial_error', {
                locationId: loc,
                error: e instanceof Error ? e.message : String(e),
              });
            }
          }
          try {
            await ejecutarCarga(db, s.cliente, tipo, {
              modo: cfg.MODO_ALERTAS,
              ...(t.data?.dias ? { dias: t.data.dias } : {}),
            });
          } catch {
            // El error queda en sync_ejecuciones y sync_estado; se sigue con las demás subcuentas.
          }
        }
      }
    });
  }
  // ---------------------------------------------------------------- Recálculo pedido desde la web
  // (cambio de modo de tiempo, zona horaria o ausencias pasadas).
  await boss.createQueue('resumen-pendiente', {
    policy: 'singleton',
    retryLimit: 1,
    expireInSeconds: 3600,
  });
  await boss.schedule('resumen-pendiente', '*/5 * * * *', {}, { tz: cfg.ZONA_HORARIA_DEFECTO });
  await boss.work('resumen-pendiente', async () => {
    await recalcularPendientes(db);
  });

  // ---------------------------------------------------------------- Purga de textos (90 días)
  await boss.createQueue('purga-textos', {
    policy: 'singleton',
    retryLimit: 1,
    expireInSeconds: 3600,
  });
  await boss.schedule('purga-textos', '30 3 * * *', {}, { tz: cfg.ZONA_HORARIA_DEFECTO });
  await boss.work('purga-textos', async () => {
    await purgarTextos(db);
  });

  // ---------------------------------------------------------------- Análisis de calidad (§6.5)
  // Modelo y tope los elige el administrador global en la web: se leen en cada ciclo.
  const proveedor = process.env.ANTHROPIC_API_KEY ? new ProveedorAnthropic() : null;
  const COLAS_CALIDAD = ['calidad-solicitudes', 'calidad-revisar', 'calidad-mensual'];
  for (const cola of COLAS_CALIDAD) {
    await boss.createQueue(cola, { policy: 'singleton', retryLimit: 0, expireInSeconds: 3600 });
  }
  await boss.schedule('calidad-solicitudes', '*/2 * * * *', {}, { tz: cfg.ZONA_HORARIA_DEFECTO });
  await boss.schedule('calidad-revisar', '*/30 * * * *', {}, { tz: cfg.ZONA_HORARIA_DEFECTO });
  await boss.schedule('calidad-mensual', '0 1 1 * *', {}, { tz: cfg.ZONA_HORARIA_DEFECTO });
  await boss.work('calidad-solicitudes', async () => {
    if (proveedor)
      await procesarPendientes(db, proveedor, await configuracionCalidadVigente(db), 'solicitudes');
  });
  await boss.work('calidad-revisar', async () => {
    if (proveedor)
      await procesarPendientes(db, proveedor, await configuracionCalidadVigente(db), 'revisar');
  });
  // Día 1 de cada mes: analiza el mes anterior de cada subcuenta activa con sus 3 etapas.
  await boss.work('calidad-mensual', async () => {
    const hoy = new Date();
    const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - 1, 1))
      .toISOString()
      .slice(0, 10);
    const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0))
      .toISOString()
      .slice(0, 10);
    for (const s of await db.select().from(tablas.subcuentas)) {
      if (!s.activa || (s.etapasCalidad ?? []).length !== 3) continue;
      const id = await solicitarAnalisis(db, {
        locationId: s.locationId,
        tipo: 'automatico',
        desde,
        hasta,
      });
      log('calidad_mensual_solicitado', { locationId: s.locationId, analisisId: id, desde, hasta });
    }
  });
  if (!proveedor)
    log('calidad_sin_clave', {
      aviso: 'Falta ANTHROPIC_API_KEY: los análisis de calidad quedan en espera.',
    });

  log('worker_iniciado', {
    modo: cfg.MODO_ALERTAS,
    colas: [...Object.values(COLAS), 'resumen-pendiente', 'purga-textos', ...COLAS_CALIDAD],
  });

  const detener = async (senal: string) => {
    log('worker_deteniendo', { senal });
    await boss.stop({ graceful: true, timeout: 30_000 });
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void detener('SIGTERM'));
  process.on('SIGINT', () => void detener('SIGINT'));
}

principal().catch((e) => {
  log('worker_error_fatal', { error: e instanceof Error ? e.message : String(e) });
  process.exit(1);
});
