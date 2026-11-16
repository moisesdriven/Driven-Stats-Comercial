import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tablas, type Db } from '@driven/db';
import { POST as ingresarRuta } from '@/app/api/auth/ingresar/route';
import { GET as historialRuta, POST as lanzarRuta } from '@/app/api/calidad/analisis/route';
import { POST as estimarRuta } from '@/app/api/calidad/estimacion/route';
import { GET as ejemplosRuta } from '@/app/api/subcuentas/[id]/asesores/[userId]/calidad/route';
import { GET as subIndRuta } from '@/app/api/subcuentas/[id]/indicadores/route';
import {
  CLAVE_PRUEBA,
  crearUsuarioPrueba,
  hayBaseDePruebas,
  llamar,
  prepararBase,
} from './entorno';

const LOC = 'LOC_Q';
const PERIODO = { subcuentas: [LOC], desde: '2026-10-01', hasta: '2026-10-31' };
const d = (dia: number, h: number, m = 0) => new Date(Date.UTC(2026, 9, dia, h, m));

describe.skipIf(!hayBaseDePruebas)('análisis de calidad desde la web (integración)', () => {
  let db: Db;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};
  const topeOriginal = process.env.IA_TOPE_MENSUAL_USD;

  beforeAll(async () => {
    db = await prepararBase();
    await db
      .insert(tablas.subcuentas)
      .values({ locationId: LOC, nombre: 'Q', etapasCalidad: ['S1', 'S2', 'S3'] });
    await db.insert(tablas.mapaEtapas).values(
      ['S1', 'S2', 'S3'].map((s, i) => ({
        locationId: LOC,
        pipelineId: 'P',
        stageId: s,
        nombreOriginal: ['Contactado', 'Cotizado', 'Adelanto'][i]!,
      })),
    );
    await db.insert(tablas.historialEtapas).values([
      {
        opportunityId: 'o1',
        locationId: LOC,
        contactId: 'K1',
        stageId: 'S1',
        desde: d(1, 0),
        fuente: 'carga',
      },
    ]);
    await db.insert(tablas.mensajes).values([
      {
        messageId: 'q1',
        locationId: LOC,
        conversationId: 'c1',
        contactId: 'K1',
        direccion: 'inbound',
        fecha: d(10, 15),
        texto: '¿Cuánto cuesta el anillo?',
      },
      {
        messageId: 'q2',
        locationId: LOC,
        conversationId: 'c1',
        contactId: 'K1',
        direccion: 'outbound',
        origen: 'manual',
        userId: 'U1',
        fecha: d(10, 15, 5),
        texto: 'Hola, el anillo cuesta S/ 890 en oro 18K, ¿para cuándo?',
      },
      {
        messageId: 'q3',
        locationId: LOC,
        conversationId: 'c1',
        contactId: 'K1',
        direccion: 'outbound',
        origen: 'manual',
        userId: 'U1',
        fecha: d(10, 15, 9),
        texto: 'Buenas tardes, soy asesora de ventas de la tienda',
      },
      {
        messageId: 'q4',
        locationId: LOC,
        conversationId: 'c1',
        contactId: 'K1',
        direccion: 'inbound',
        fecha: d(10, 15, 20),
        texto: 'Para diciembre',
      },
    ]);
    ids.admin = await crearUsuarioPrueba(db, { correo: 'admin@q.pe', rol: 'admin' });
    await crearUsuarioPrueba(db, { correo: 'dueno@q.pe', rol: 'dueno', subcuentas: [LOC] });
    await crearUsuarioPrueba(db, {
      correo: 'asesor@q.pe',
      rol: 'asesor',
      subcuentas: [LOC],
      userIdGhl: 'U1',
    });
    ids.super = await crearUsuarioPrueba(db, {
      correo: 'super@q.pe',
      rol: 'supervisor',
      subcuentas: [LOC],
    });
    await db
      .insert(tablas.permisosUsuario)
      .values({ usuarioId: ids.super, modulo: 'texto_mensajes', nivel: 'ninguno' });
    for (const k of ['admin', 'dueno', 'asesor', 'super']) {
      cookies[k] = (
        await llamar(ingresarRuta, '/api/auth/ingresar', {
          cuerpo: { correo: `${k}@q.pe`, clave: CLAVE_PRUEBA },
        })
      ).cookie!;
    }
  });

  afterAll(() => {
    if (topeOriginal === undefined) delete process.env.IA_TOPE_MENSUAL_USD;
    else process.env.IA_TOPE_MENSUAL_USD = topeOriginal;
  });

  it('solo el administrador ve la estimación, con elegibles, muestra, mensajes y costo', async () => {
    expect(
      (
        await llamar(estimarRuta, '/api/calidad/estimacion', {
          cookie: cookies.dueno,
          cuerpo: PERIODO,
        })
      ).estado,
    ).toBe(403);
    const r = await llamar(estimarRuta, '/api/calidad/estimacion', {
      cookie: cookies.admin,
      cuerpo: PERIODO,
    });
    expect(r.estado).toBe(200);
    const s = (r.cuerpo.subcuentas as Record<string, unknown>[])[0]!;
    expect(s).toMatchObject({
      conversacionesElegibles: 1,
      muestra: 1,
      mensajesEstimados: 2,
      manualesMes: 0,
      enCurso: false,
    });
    expect(s.costoEstimadoUsd as number).toBeGreaterThan(0);
    expect(r.cuerpo).toMatchObject({ modelo: 'claude-haiku-5-5', topeMensualUsd: 10 });
  });

  it('lanzar exige la contraseña; crea el análisis y lo registra con el costo estimado', async () => {
    expect(
      (
        await llamar(lanzarRuta, '/api/calidad/analisis', {
          cookie: cookies.admin,
          cuerpo: PERIODO,
        })
      ).estado,
    ).toBe(401);
    const r = await llamar(lanzarRuta, '/api/calidad/analisis', {
      cookie: cookies.admin,
      cuerpo: { ...PERIODO, clave: CLAVE_PRUEBA },
    });
    expect(r.estado).toBe(202);
    const [a] = await db.select().from(tablas.analisisCalidad);
    expect(a).toMatchObject({ estado: 'solicitado', tipo: 'manual', lanzadoPor: ids.admin });
    const reg = (await db.select().from(tablas.auditoria)).find((x) => x.que === 'calidad_lanzado');
    expect(reg?.detalle).toHaveProperty('costoEstimadoUsd');
  });

  it('no permite otro análisis mientras hay uno en curso', async () => {
    const r = await llamar(lanzarRuta, '/api/calidad/analisis', {
      cookie: cookies.admin,
      cuerpo: { ...PERIODO, clave: CLAVE_PRUEBA },
    });
    expect(r.estado).toBe(409);
    expect(r.cuerpo.codigo).toBe('analisis_en_curso');
  });

  it('respeta el máximo de análisis manuales por mes', async () => {
    await db.update(tablas.analisisCalidad).set({ estado: 'terminado' });
    for (let i = 0; i < 2; i++) {
      await db.insert(tablas.analisisCalidad).values({
        locationId: LOC,
        tipo: 'manual',
        periodoDesde: '2026-10-01',
        periodoHasta: '2026-10-31',
        semilla: `s${i}`,
        estado: 'terminado',
      });
    }
    const r = await llamar(lanzarRuta, '/api/calidad/analisis', {
      cookie: cookies.admin,
      cuerpo: { ...PERIODO, clave: CLAVE_PRUEBA },
    });
    expect(r.cuerpo.codigo).toBe('limite_manuales');
  });

  it('respeta el tope de gasto mensual', async () => {
    await db.delete(tablas.analisisCalidad);
    process.env.IA_TOPE_MENSUAL_USD = '0.000001';
    const r = await llamar(lanzarRuta, '/api/calidad/analisis', {
      cookie: cookies.admin,
      cuerpo: { ...PERIODO, clave: CLAVE_PRUEBA },
    });
    expect(r.cuerpo.codigo).toBe('tope_gasto');
    process.env.IA_TOPE_MENSUAL_USD = '10';
  });

  describe('resultados', () => {
    beforeAll(async () => {
      await db.delete(tablas.analisisCalidad);
      const [a] = await db
        .insert(tablas.analisisCalidad)
        .values({
          locationId: LOC,
          tipo: 'manual',
          periodoDesde: '2026-10-01',
          periodoHasta: '2026-10-31',
          semilla: 'x',
          estado: 'terminado',
          conversacionesMuestra: 1,
          cerradoEn: new Date(),
        })
        .returning({ id: tablas.analisisCalidad.id });
      const criterios = (v: boolean[]) =>
        Object.fromEntries(
          ['responde', 'personalizado', 'siguiente_paso', 'tono', 'extension'].map((k, i) => [
            k,
            v[i],
          ]),
        );
      await db.insert(tablas.clasificaciones).values([
        {
          analisisId: a!.id,
          messageId: 'q2',
          conversationId: 'c1',
          asesorId: 'U1',
          categoria: 'info_producto_precio',
          puntaje: 4,
          criterios: criterios([true, false, true, true, true]),
          motivo: 'Responde el precio',
          modelo: 'claude-haiku-5-5',
          versionRubrica: 'v1',
        },
        {
          analisisId: a!.id,
          messageId: 'q3',
          conversationId: 'c1',
          asesorId: 'U1',
          categoria: 'saludo_plantilla',
          puntaje: 2,
          criterios: criterios([false, false, false, true, true]),
          motivo: 'Genérico',
          modelo: 'claude-haiku-5-5',
          versionRubrica: 'v1',
        },
      ]);
      await db.insert(tablas.ejemplosCalidad).values({
        analisisId: a!.id,
        asesorId: 'U1',
        locationId: LOC,
        mejorMessageId: 'q2',
        peorMessageId: 'q3',
      });
    });

    it('la calidad del último análisis entra en los indicadores y en el semáforo de Negociación', async () => {
      const r = await llamar(
        subIndRuta,
        `/api/subcuentas/${LOC}/indicadores?desde=2026-11-01&hasta=2026-11-07`,
        { cookie: cookies.dueno, params: { id: LOC } },
      );
      expect((r.cuerpo.indicadores as { calidad: number }).calidad).toBe(3);
      expect(r.cuerpo.calidad).toMatchObject({
        muestra: 1,
        distribucion: { info_producto_precio: 1, saludo_plantilla: 1 },
      });
      // 3 / 3,5 = 0,857: dentro del 20 % de tolerancia → amarillo.
      expect((r.cuerpo.evaluacion as { estados: { calidad: string } }).estados.calidad).toBe(
        'amarillo',
      );
    });

    it('el panel de mejor y peor mensaje muestra contexto y resultado; el asesor ve solo el suyo', async () => {
      const r = await llamar(ejemplosRuta, `/api/subcuentas/${LOC}/asesores/U1/calidad`, {
        cookie: cookies.asesor,
        params: { id: LOC, userId: 'U1' },
      });
      expect(r.estado).toBe(200);
      const ej = r.cuerpo.ejemplos as Record<string, unknown>[];
      expect(ej.map((e) => e.tipo)).toEqual(['mejor', 'peor']);
      expect(ej[0]).toMatchObject({
        puntaje: 4,
        mensajePrevioCliente: '¿Cuánto cuesta el anillo?',
        clienteRespondio: true,
        huboVenta: false,
      });
      expect((r.cuerpo.analisis as { etapas: string[] }).etapas.sort()).toEqual([
        'Adelanto',
        'Contactado',
        'Cotizado',
      ]);
      expect(
        (
          await llamar(ejemplosRuta, `/api/subcuentas/${LOC}/asesores/U2/calidad`, {
            cookie: cookies.asesor,
            params: { id: LOC, userId: 'U2' },
          })
        ).estado,
      ).toBe(403);
    });

    it('sin el módulo de texto de mensajes no se ven los textos', async () => {
      const r = await llamar(ejemplosRuta, `/api/subcuentas/${LOC}/asesores/U1/calidad`, {
        cookie: cookies.super,
        params: { id: LOC, userId: 'U1' },
      });
      expect(r.estado).toBe(403);
    });

    it('el historial no expone la semilla ni los ids de lote', async () => {
      const r = await llamar(historialRuta, '/api/calidad/analisis', { cookie: cookies.admin });
      expect(r.estado).toBe(200);
      expect(JSON.stringify(r.cuerpo)).not.toContain('semilla');
      expect(r.cuerpo).toHaveProperty('gastoDelMesUsd');
    });
  });
});
