import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { configuracionCalidad, prepararSolicitudes, tablas, type Db } from '@driven/db';
import { baseWorker, URL_PRUEBAS } from '../pruebas/base';
import { prepararAnalisis, revisarAnalisis, solicitarAnalisis } from './proceso';
import { crearProveedorSimulado } from './simulado';

const LOC = 'LOC_CAL';
const ETAPAS = ['S_CONT', 'S_COT', 'S_ADEL'];
const d = (dia: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, dia, h, m));

describe.skipIf(!URL_PRUEBAS)('análisis de calidad (integración con Anthropic simulado)', () => {
  let db: Db;
  const cfg = { ...configuracionCalidad({}), tamanoMuestra: 1000, topeMensualUsd: 10 };
  let n = 0;
  const msg = (
    contacto: string,
    fecha: Date,
    direccion: 'inbound' | 'outbound',
    origen: string | null,
    texto: string,
  ) => ({
    messageId: `m${++n}`,
    locationId: LOC,
    conversationId: `conv_${contacto}`,
    contactId: contacto,
    direccion,
    origen: origen as 'manual' | null,
    userId: origen === 'manual' ? (contacto.startsWith('A') ? 'UA' : 'UB') : null,
    texto,
    fecha,
  });

  beforeAll(async () => {
    db = await baseWorker();
    await db.insert(tablas.subcuentas).values([
      { locationId: LOC, nombre: 'Calidad', etapasCalidad: ETAPAS },
      { locationId: 'LOC_SIN_ETAPAS', nombre: 'Sin etapas' },
    ]);
    // Contactos A1..A3 (asesora UA) y B1..B2 (UB) en Contactado/Cotizado durante octubre.
    const contactos = ['A1', 'A2', 'A3', 'B1', 'B2', 'X1'];
    await db.insert(tablas.historialEtapas).values(
      contactos.map((c) => ({
        opportunityId: `o_${c}`,
        locationId: LOC,
        contactId: c,
        stageId: c === 'X1' ? 'S_NUEVO' : 'S_CONT',
        desde: d(1, 0),
        hasta: null,
        fuente: 'carga' as const,
      })),
    );
    const filas = [];
    for (const c of ['A1', 'A2', 'A3', 'B1', 'B2']) {
      filas.push(msg(c, d(10, 15), 'inbound', null, '¿Cuánto cuesta el anillo solitario de oro?'));
      filas.push(
        msg(
          c,
          d(10, 15, 5),
          'outbound',
          'manual',
          'Hola María, el solitario cuesta S/ 890 en oro 18K. ¿Para qué fecha lo necesitas?',
        ),
      );
      filas.push(msg(c, d(10, 15, 6), 'outbound', 'manual', 'Gracias')); // trivial
      filas.push(
        msg(
          c,
          d(10, 15, 7),
          'outbound',
          'agente_ia',
          'Mensaje largo del agente de IA que no se califica nunca',
        ),
      );
      filas.push(
        msg(
          c,
          d(10, 16),
          'outbound',
          'manual',
          'Buenas tardes, soy asesora de ventas de la joyería',
        ),
      );
    }
    filas.push(
      msg(
        'X1',
        d(10, 15),
        'outbound',
        'manual',
        'Mensaje manual fuera de las etapas de calidad elegidas',
      ),
    ); // fuera de etapas
    filas.push(
      msg('A1', d(10, 17), 'outbound', 'sin_origen', 'Mensaje con origen no confirmado por GHL'),
    );
    filas.push(
      msg('A1', d(20, 15), 'outbound', 'manual', 'Mensaje fuera del periodo del análisis'),
    ); // fuera del periodo (20 oct)
    await db.insert(tablas.mensajes).values(filas);
  });

  it('arma el universo con los descartes por filtro y una muestra reproducible', async () => {
    const p = { locationId: LOC, etapas: ETAPAS, desde: d(1, 0), hasta: d(16, 0), semilla: 'fija' };
    const a = await prepararSolicitudes(db, p, cfg);
    expect(a.universo.conversaciones).toBe(5);
    expect(a.universo.porAsesor.get('UA')).toHaveLength(3);
    expect(a.descartes).toMatchObject({ sinOrigen: 1, fueraDeEtapas: 1, triviales: 5 });
    expect(a.solicitudes).toHaveLength(5);
    expect(a.solicitudes[0]!.mensajes).toBe(2); // "Gracias" e IA fuera
    expect(a.solicitudes[0]!.texto).toContain('[AUTOMATICO] Mensaje largo del agente de IA');
    expect(a.estimacion.costoUsd).toBeGreaterThan(0);
    const b = await prepararSolicitudes(db, p, cfg);
    expect(b.solicitudes.map((s) => s.customId)).toEqual(a.solicitudes.map((s) => s.customId));
  });

  it('envía, espera el lote, reintenta una vez y cierra con calificaciones, ejemplos y costo real', async () => {
    const { proveedor, lotes } = crearProveedorSimulado({
      esperas: 1,
      invalidoUnaVez: 'conv_A2',
      siempreError: 'conv_B2',
    });
    const id = await solicitarAnalisis(db, {
      locationId: LOC,
      tipo: 'manual',
      desde: '2026-10-01',
      hasta: '2026-10-15',
    });
    await prepararAnalisis(db, proveedor, id, cfg);
    let [a] = await db
      .select()
      .from(tablas.analisisCalidad)
      .where(eq(tablas.analisisCalidad.id, id));
    expect(a?.estado).toBe('enviado');
    expect(a?.batchIds).toHaveLength(1);
    const primera = [...lotes.values()][0]![0]!;
    expect(primera.params.model).toBe('claude-haiku-5-5');
    expect(primera.params.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(primera.params.output_config.format.type).toBe('json_schema');

    expect(await revisarAnalisis(db, proveedor, id, cfg)).toBe('esperando');
    expect(await revisarAnalisis(db, proveedor, id, cfg)).toBe('reintentando'); // A2 inválido y B2 con error
    expect(await revisarAnalisis(db, proveedor, id, cfg)).toBe('esperando'); // el lote del reintento
    expect(await revisarAnalisis(db, proveedor, id, cfg)).toBe('terminado'); // A2 bien; B2 falla definitivamente

    [a] = await db.select().from(tablas.analisisCalidad).where(eq(tablas.analisisCalidad.id, id));
    expect(a?.estado).toBe('terminado');
    expect(a?.mensajesCalificados).toBe(8); // 4 conversaciones × 2 mensajes
    expect(a?.fallidos).toBe(1);
    expect(a?.costoReal).toBeGreaterThan(0);
    expect(a?.tokensEntrada).toBeGreaterThan(0);

    const cal = await db
      .select()
      .from(tablas.clasificaciones)
      .where(eq(tablas.clasificaciones.analisisId, id));
    const precio = cal.find((c) => c.categoria === 'info_producto_precio');
    expect(precio?.puntaje).toBe(5); // responde, personalizado, siguiente paso, tono, extensión
    expect(cal.find((c) => c.categoria === 'saludo_plantilla')?.puntaje).toBe(2); // tono + extensión

    const ej = await db
      .select()
      .from(tablas.ejemplosCalidad)
      .where(eq(tablas.ejemplosCalidad.analisisId, id));
    expect(ej.map((e) => e.asesorId).sort()).toEqual(['UA', 'UB']);
    expect(ej.every((e) => e.mejorMessageId !== e.peorMessageId)).toBe(true);
  });

  it('se detiene sin enviar si superaría el tope mensual', async () => {
    const { proveedor, lotes } = crearProveedorSimulado();
    const id = await solicitarAnalisis(db, {
      locationId: LOC,
      tipo: 'manual',
      desde: '2026-10-01',
      hasta: '2026-10-15',
    });
    await prepararAnalisis(db, proveedor, id, { ...cfg, topeMensualUsd: 0.000001 });
    const [a] = await db
      .select()
      .from(tablas.analisisCalidad)
      .where(eq(tablas.analisisCalidad.id, id));
    expect(a?.estado).toBe('detenido_por_tope');
    expect(lotes.size).toBe(0);
  });

  it('una subcuenta sin sus 3 etapas no se analiza', async () => {
    const { proveedor } = crearProveedorSimulado();
    const id = await solicitarAnalisis(db, {
      locationId: 'LOC_SIN_ETAPAS',
      tipo: 'automatico',
      desde: '2026-10-01',
      hasta: '2026-10-31',
    });
    await prepararAnalisis(db, proveedor, id, cfg);
    const [a] = await db
      .select()
      .from(tablas.analisisCalidad)
      .where(eq(tablas.analisisCalidad.id, id));
    expect(a?.estado).toBe('fallido');
    expect(a?.error).toMatch(/3 etapas/);
  });
});
