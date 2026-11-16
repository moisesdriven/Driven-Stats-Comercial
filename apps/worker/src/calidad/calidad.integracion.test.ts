import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { configuracionCalidad, prepararSolicitudes, tablas, type Db } from '@driven/db';
import { baseWorker, URL_PRUEBAS } from '../pruebas/base';
import { calibrar } from './calibracion';
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
    // "Gracias" (trivial) e IA fuera; el saludo se califica por regla: a la IA va 1 mensaje.
    expect(a.solicitudes[0]!.mensajes).toBe(1);
    expect(a.solicitudes[0]!.porRegla).toHaveLength(1);
    const sinRegla = await prepararSolicitudes(db, p, { ...cfg, saludosPorRegla: false });
    expect(sinRegla.solicitudes[0]!.mensajes).toBe(2);
    expect(sinRegla.solicitudes[0]!.porRegla).toHaveLength(0);
    expect(a.estimacion.tokensSalida).toBeLessThan(sinRegla.estimacion.tokensSalida);
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
    // 4 conversaciones × 2 mensajes + el saludo de B2, que se califica por regla aunque su
    // solicitud a la IA haya fallado.
    expect(a?.mensajesCalificados).toBe(9);
    expect(a?.fallidos).toBe(1);
    expect(a?.costoReal).toBeGreaterThan(0);
    expect(a?.tokensEntrada).toBeGreaterThan(0);

    const cal = await db
      .select()
      .from(tablas.clasificaciones)
      .where(eq(tablas.clasificaciones.analisisId, id));
    const precio = cal.find((c) => c.categoria === 'info_producto_precio');
    // El simulado marca "personalizado" (usa "María"), pero el mismo texto fue a 4 conversaciones:
    // la unificación por texto lo deja en falso (misma frase, mismo resultado).
    expect(precio?.criterios).toMatchObject({ responde: true, personalizado: false });
    expect(precio?.puntaje).toBe(4);
    expect(
      new Set(cal.filter((c) => c.categoria === 'info_producto_precio').map((c) => c.puntaje)),
    ).toEqual(new Set([4]));
    // "Buenas tardes, soy asesora de ventas…" es un saludo suelto: se califica por regla, sin IA.
    // El cliente había pedido el precio y ya se lo dieron: el pedido está cerrado, así que responde.
    const saludo = cal.find((c) => c.categoria === 'saludo_plantilla');
    expect(saludo?.modelo).toBe('regla-saludos-v1');
    expect(saludo?.criterios).toMatchObject({ responde: true, personalizado: false });
    expect(saludo?.puntaje).toBe(3); // responde + tono + extensión
    expect(primera.params.messages[0]!.content).toContain('[ASESOR] Buenas tardes, soy asesora');

    const ej = await db
      .select()
      .from(tablas.ejemplosCalidad)
      .where(eq(tablas.ejemplosCalidad.analisisId, id));
    expect(ej.map((e) => e.asesorId).sort()).toEqual(['UA', 'UB']);
    expect(ej.every((e) => e.mejorMessageId !== e.peorMessageId)).toBe(true);
  });

  it('calibra: arma el contexto desde la base y mide la coincidencia con la referencia', async () => {
    const ids = await db
      .select({ id: tablas.mensajes.messageId, texto: tablas.mensajes.texto })
      .from(tablas.mensajes)
      .where(eq(tablas.mensajes.conversationId, 'conv_A1'));
    const precio = ids.find((m) => m.texto?.includes('S/ 890'))!.id;
    const saludo = ids.find((m) => m.texto?.startsWith('Buenas tardes'))!.id;
    const { proveedor, lotes } = crearProveedorSimulado({ esperas: 1 });
    const si = {
      responde: true,
      personalizado: true,
      siguiente_paso: true,
      tono: true,
      extension: true,
    };
    const informe = await calibrar(
      db,
      proveedor,
      {
        descripcion: 'prueba',
        locationId: LOC,
        mensajes: [
          { messageId: precio, categoria: 'info_producto_precio', criterios: si },
          // La referencia dice que el saludo sí respondía: el simulado dirá que no (puntaje a 1 punto).
          {
            messageId: saludo,
            categoria: 'saludo_plantilla',
            criterios: { ...si, personalizado: false, siguiente_paso: false },
          },
          { messageId: 'no_existe', categoria: 'seguimiento', criterios: si },
        ],
      },
      { modelo: 'claude-haiku-5-5', esperaMs: 0, saludosPorRegla: false },
    );
    const enviado = [...lotes.values()][0]!;
    expect(enviado).toHaveLength(2);
    expect(enviado[0]!.params.messages[0]!.content).toContain('[CLIENTE] ¿Cuánto cuesta');
    expect(enviado[0]!.params.messages[0]!.content.match(/\[ASESOR #\d/g)).toHaveLength(1);
    expect(informe.faltantes).toEqual(['no_existe']);
    expect(informe.total).toBe(2);
    expect(informe.categoria).toBe(2);
    expect(informe.puntajeExacto).toBe(1);
    expect(informe.puntajeUnPunto).toBe(2);
    expect(informe.diferencias).toEqual([
      { messageId: saludo, campo: 'responde', esperado: 'true', obtenido: 'false' },
    ]);
    expect(informe.costoUsd).toBeGreaterThan(0);

    // Con la regla de saludos (como en un análisis real), el saludo no va a la IA: el cliente ya
    // tenía su precio, así que responde, como dice la referencia.
    const conRegla = crearProveedorSimulado({ esperas: 0 });
    const informe2 = await calibrar(
      db,
      conRegla.proveedor,
      {
        descripcion: 'prueba',
        locationId: LOC,
        mensajes: [
          { messageId: precio, categoria: 'info_producto_precio', criterios: si },
          {
            messageId: saludo,
            categoria: 'saludo_plantilla',
            criterios: { ...si, personalizado: false, siguiente_paso: false },
          },
        ],
      },
      { modelo: 'claude-haiku-5-5', esperaMs: 0 },
    );
    expect([...conRegla.lotes.values()][0]).toHaveLength(1);
    expect(informe2.porRegla).toBe(1);
    expect(informe2.puntajeExacto).toBe(2);
    expect(informe2.diferencias).toEqual([]);
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

  it('sin trabajo repetido: reutiliza lo ya calificado y solo envía lo que cambió', async () => {
    // El análisis del 1 al 15 oct calificó A1, A2, A3 y B1; B2 falló, pero su texto es idéntico al
    // de las demás, así que también se reutiliza (los mensajes se emparejan por su número).
    const p = { locationId: LOC, etapas: ETAPAS, desde: d(1, 0), hasta: d(16, 0), semilla: 'otra' };
    const prep = await prepararSolicitudes(db, p, cfg);
    expect(prep.solicitudes.every((s) => s.reutilizarDe !== null)).toBe(true);
    const b2 = prep.solicitudes.find((s) => s.conversationId === 'conv_B2')!;
    expect(b2.reutilizarDe?.conversationId).not.toBe('conv_B2');
    expect(prep.estimacion.solicitudes).toBe(0);
    // Otro modelo cambia la huella: nada se reutiliza.
    const otro = await prepararSolicitudes(db, p, { ...cfg, modelo: 'otro-modelo' });
    expect(otro.solicitudes.every((s) => s.reutilizarDe === null)).toBe(true);

    // Un mensaje nuevo del cliente en A3 cambia su texto: esa conversación se vuelve a enviar.
    await db
      .insert(tablas.mensajes)
      .values(msg('A3', d(10, 15, 3), 'inbound', null, '¿Y tienen en oro blanco?'));
    const despues = await prepararSolicitudes(db, p, cfg);
    expect(
      despues.solicitudes.filter((s) => s.reutilizarDe === null).map((s) => s.conversationId),
    ).toEqual(['conv_A3']);
    expect(despues.estimacion.solicitudes).toBe(1);
    expect(despues.estimacion.costoUsd).toBeLessThan(otro.estimacion.costoUsd);

    const lanzar = async () => {
      const { proveedor, lotes } = crearProveedorSimulado({ esperas: 0 });
      const id = await solicitarAnalisis(db, {
        locationId: LOC,
        tipo: 'manual',
        desde: '2026-10-01',
        hasta: '2026-10-15',
      });
      await prepararAnalisis(db, proveedor, id, cfg);
      return { id, proveedor, lotes };
    };
    const segundo = await lanzar();
    const enviadas = [...segundo.lotes.values()].flat();
    expect(enviadas.map((s) => s.custom_id)).toEqual([`a${segundo.id}_conv_A3`]);
    const muestra = await db
      .select()
      .from(tablas.analisisCalidadMuestra)
      .where(eq(tablas.analisisCalidadMuestra.analisisId, segundo.id));
    expect(muestra.filter((m) => m.estado === 'reutilizado')).toHaveLength(4);
    expect(muestra.every((m) => m.huella?.length === 64)).toBe(true);
    expect(await revisarAnalisis(db, segundo.proveedor, segundo.id, cfg)).toBe('terminado');
    const [a2] = await db
      .select()
      .from(tablas.analisisCalidad)
      .where(eq(tablas.analisisCalidad.id, segundo.id));
    expect(a2?.estado).toBe('terminado');
    expect(a2?.mensajesCalificados).toBe(10); // 4 × 2 reutilizados (B2 incluida) + 2 de A3
    const deB2 = await db
      .select()
      .from(tablas.clasificaciones)
      .where(eq(tablas.clasificaciones.analisisId, segundo.id));
    expect(deB2.filter((c) => c.conversationId === 'conv_B2')).toHaveLength(2);
    expect(deB2.find((c) => c.conversationId === 'conv_B2')?.asesorId).toBe('UB');

    // Un tercero ya no envía nada: se cierra de inmediato, sin costo.
    const tercero = await lanzar();
    expect(tercero.lotes.size).toBe(0);
    const [a3] = await db
      .select()
      .from(tablas.analisisCalidad)
      .where(eq(tablas.analisisCalidad.id, tercero.id));
    expect(a3?.estado).toBe('terminado');
    expect(a3?.mensajesCalificados).toBe(10);
    expect(a3?.costoEstimado).toBe(0);
  });
});
