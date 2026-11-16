/**
 * Comandos del worker (se ejecutan dentro del contenedor):
 *   node dist/cli.js historico [--dias 90] [--subcuenta <locationId>]   encola la carga histórica
 *   node dist/cli.js incremental [--subcuenta <locationId>]             encola una incremental ya
 *   node dist/cli.js nocturno [--subcuenta <locationId>]                encola la nocturna ya
 *   node dist/cli.js estado                                             últimas ejecuciones
 * Con --directo se ejecuta en este proceso en vez de encolar (útil en pruebas en modo sombra).
 */
import { desc } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { crearConexion, ESQUEMA_COLA, tablas } from '@driven/db';
import { leerConfiguracion } from './configuracion';
import { subcuentasActivas } from './subcuentas';
import { ejecutarCarga, type TipoCarga } from './sync/ejecutar';

const COLAS: Record<TipoCarga, string> = {
  incremental: 'sync-incremental',
  nocturno: 'sync-nocturno',
  historico: 'sync-historico',
};

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function principal() {
  const comando = process.argv[2];
  const cfg = leerConfiguracion();
  const { db, pool } = crearConexion(cfg.DATABASE_URL_WORKER, 4);
  try {
    if (comando === 'estado') {
      const filas = await db
        .select()
        .from(tablas.syncEjecuciones)
        .orderBy(desc(tablas.syncEjecuciones.inicio))
        .limit(15);
      for (const f of filas) {
        console.log(
          `${f.inicio.toISOString()}  ${f.locationId}  ${f.tipo.padEnd(11)} ${f.estado.padEnd(8)} llamadas=${f.llamadas}${f.error ? `  error: ${f.error}` : ''}`,
        );
      }
      return;
    }
    if (!comando || !(comando in COLAS)) {
      console.error(
        'Uso: cli.js <historico|incremental|nocturno|estado> [--dias N] [--subcuenta ID] [--directo]',
      );
      process.exitCode = 2;
      return;
    }
    const tipo = comando as TipoCarga;
    const dias = arg('dias') ? Number(arg('dias')) : undefined;
    const subcuenta = arg('subcuenta');
    if (process.argv.includes('--directo')) {
      for (const s of await subcuentasActivas(db, cfg.GHL_MAX_LLAMADAS_10S, subcuenta)) {
        console.log(`Cargando ${s.nombre} (${s.locationId})…`);
        const r = await ejecutarCarga(db, s.cliente, tipo, {
          modo: cfg.MODO_ALERTAS,
          ...(dias ? { dias } : {}),
        });
        console.log(JSON.stringify(r, null, 2));
      }
      return;
    }
    const boss = new PgBoss({
      connectionString: cfg.DATABASE_URL_WORKER,
      schema: ESQUEMA_COLA,
      max: 1,
    });
    await boss.start();
    await boss.createQueue(COLAS[tipo], {
      policy: 'singleton',
      retryLimit: 1,
      retryDelay: 60,
      expireInSeconds: 6 * 3600,
    });
    const id = await boss.send(COLAS[tipo], {
      ...(subcuenta ? { subcuenta } : {}),
      ...(dias ? { dias } : {}),
    });
    console.log(
      id
        ? `Carga ${tipo} encolada (${id}). Sigue el avance con: docker logs -f comercial-worker`
        : `Ya hay una carga ${tipo} en curso o en cola.`,
    );
    await boss.stop({ graceful: false });
  } finally {
    await pool.end();
  }
}

principal().catch((e) => {
  console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
