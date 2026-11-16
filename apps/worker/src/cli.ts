/**
 * Comandos del worker (se ejecutan dentro del contenedor):
 *   node dist/cli.js historico [--dias 90] [--subcuenta <locationId>]   encola la carga histórica
 *   node dist/cli.js incremental [--subcuenta <locationId>]             encola una incremental ya
 *   node dist/cli.js nocturno [--subcuenta <locationId>]                encola la nocturna ya
 *   node dist/cli.js resumen [--dias 7] [--subcuenta <locationId>]      recalcula resumen_diario
 *   node dist/cli.js calidad-estimar --subcuenta ID --desde F --hasta F   costo estimado (no envía nada)
 *   node dist/cli.js calidad-revisar                                     revisa lotes enviados ahora
 *   node dist/cli.js calidad-calibrar --archivo F [--minimo 0.9] [--esfuerzo low] [--pensamiento si]  coincidencia con la revisión humana
 *   node dist/cli.js estado                                             últimas ejecuciones
 * Con --directo se ejecuta en este proceso en vez de encolar (útil en pruebas en modo sombra).
 */
import { desc } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import {
  configuracionCalidad,
  crearConexion,
  ESQUEMA_COLA,
  gastoDelMes,
  leerAjustesIa,
  prepararSolicitudes,
  tablas,
} from '@driven/db';
import { calibrar, leerConjunto } from './calidad/calibracion';
import { procesarPendientes } from './calidad/proceso';
import { ProveedorAnthropic } from './calidad/proveedor';
import { leerConfiguracion } from './configuracion';
import { subcuentasActivas } from './subcuentas';
import { calcularResumen, hoyEn, sumarDias } from './calculo/resumen';
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
    if (comando === 'calidad-estimar') {
      const cfgC = configuracionCalidad();
      const id = arg('subcuenta');
      const [sub] = (await db.select().from(tablas.subcuentas)).filter((x) => x.locationId === id);
      if (!sub || (sub.etapasCalidad ?? []).length !== 3)
        throw new Error('Subcuenta inexistente o sin sus 3 etapas de calidad.');
      const desde = new Date(`${arg('desde')}T00:00:00Z`);
      const hasta = new Date(Date.parse(`${arg('hasta')}T00:00:00Z`) + 86_400_000);
      const p = await prepararSolicitudes(
        db,
        { locationId: sub.locationId, etapas: sub.etapasCalidad!, desde, hasta },
        cfgC,
      );
      const gasto = await gastoDelMes(db);
      console.log(
        JSON.stringify(
          {
            subcuenta: sub.nombre,
            periodo: [arg('desde'), arg('hasta')],
            conversacionesElegibles: p.universo.conversaciones,
            porAsesor: Object.fromEntries([...p.universo.porAsesor].map(([a, l]) => [a, l.length])),
            muestra: p.muestra.length,
            solicitudes: p.solicitudes.length,
            mensajesACalificar: p.solicitudes.reduce((s2, x) => s2 + x.mensajes, 0),
            descartes: { ...p.descartes, sinMensajesCalificables: p.sinMensajes.length },
            estimacion: p.estimacion,
            gastoDelMesUsd: gasto,
            topeMensualUsd: cfgC.topeMensualUsd,
            modelo: cfgC.modelo,
          },
          null,
          2,
        ),
      );
      return;
    }
    if (comando === 'calidad-revisar') {
      await procesarPendientes(db, new ProveedorAnthropic(), configuracionCalidad(), 'solicitudes');
      await procesarPendientes(db, new ProveedorAnthropic(), configuracionCalidad(), 'revisar');
      return;
    }
    if (comando === 'calidad-calibrar') {
      const archivo = arg('archivo');
      if (!archivo) throw new Error('Falta --archivo con el conjunto de calibración.');
      const minimo = Number(arg('minimo') ?? 0.9);
      const informe = await calibrar(db, new ProveedorAnthropic(), await leerConjunto(archivo), {
        modelo: arg('modelo') ?? configuracionCalidad().modelo,
        ajustes: leerAjustesIa(
          arg('esfuerzo') ?? process.env.IA_ESFUERZO,
          arg('pensamiento') ?? process.env.IA_PENSAMIENTO,
        ),
      });
      console.log(JSON.stringify(informe, null, 2));
      const aprobado = informe.tasas.puntajeExacto >= minimo;
      console.log(
        `${aprobado ? 'APROBADO' : 'NO APROBADO'}: puntaje exacto ${(informe.tasas.puntajeExacto * 100).toFixed(1)} % (mínimo ${(minimo * 100).toFixed(0)} %), rúbrica ${informe.versionRubrica}, costo US$ ${informe.costoUsd}`,
      );
      if (!aprobado) process.exitCode = 1;
      return;
    }
    if (comando === 'resumen') {
      const dias = Number(arg('dias') ?? 7);
      const filas = await db.select().from(tablas.subcuentas);
      for (const s of filas.filter(
        (x) => x.activa && (!arg('subcuenta') || x.locationId === arg('subcuenta')),
      )) {
        const hoy = hoyEn(s.zonaHoraria);
        const r = await calcularResumen(db, s.locationId, {
          desde: sumarDias(hoy, -dias + 1),
          hasta: hoy,
        });
        console.log(
          `${s.nombre}: ${r.dias} días, ${r.leads} leads, ${r.filas} filas en ${Math.round(r.ms / 1000)} s`,
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
