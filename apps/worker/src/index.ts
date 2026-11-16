/**
 * Worker de Driven Comercial: cargas desde GHL con pg-boss (esquema `comercial_cola`).
 *   sync-incremental  cada SYNC_INCREMENTAL_MINUTOS (15 por defecto)
 *   sync-nocturno     diario a SYNC_NOCTURNO_HORA, hora de Lima (02:30 por defecto)
 *   sync-historico    manual: node dist/cli.js historico --dias 90 [--subcuenta <locationId>]
 * Una sola ejecución activa por cola (política singleton). Modo `sombra` por defecto.
 */
import { PgBoss } from 'pg-boss';
import { crearConexion, ESQUEMA_COLA } from '@driven/db';
import { leerConfiguracion } from './configuracion';
import { subcuentasActivas } from './subcuentas';
import { ejecutarCarga, type TipoCarga } from './sync/ejecutar';
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
  log('worker_iniciado', { modo: cfg.MODO_ALERTAS, colas: Object.values(COLAS) });

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
