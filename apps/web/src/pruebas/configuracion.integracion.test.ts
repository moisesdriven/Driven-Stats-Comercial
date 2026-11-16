import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tablas, type Db } from '@driven/db';
import { crearGhlSimulado } from '@driven/ghl';
import { POST as ingresarRuta } from '@/app/api/auth/ingresar/route';
import { POST as altaRuta } from '@/app/api/configuracion/subcuentas/route';
import { PUT as mapaRuta } from '@/app/api/configuracion/subcuentas/[id]/mapa-etapas/route';
import { PUT as calidadRuta } from '@/app/api/subcuentas/[id]/etapas-calidad/route';
import { cargarContexto } from '@/servidor/acceso';
import { darDeAltaSubcuenta } from '@/servidor/configuracion';
import {
  CLAVE_PRUEBA,
  crearUsuarioPrueba,
  hayBaseDePruebas,
  llamar,
  prepararBase,
} from './entorno';

const LOC = 'LOC_CFG';
const TOKEN = 'pit-simulado-de-prueba';

describe.skipIf(!hayBaseDePruebas)('configuración de subcuentas (integración)', () => {
  let db: Db;
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    db = await prepararBase();
    await db.insert(tablas.subcuentas).values([{ locationId: 'LOC_OTRA', nombre: 'Otra' }]);
    ids.admin = await crearUsuarioPrueba(db, { correo: 'admin@cfg.pe', rol: 'admin' });
    for (const [k, rol] of [['admin', 'admin']] as const) {
      const r = await llamar(ingresarRuta, '/api/auth/ingresar', {
        cuerpo: { correo: `${k}@cfg.pe`, clave: CLAVE_PRUEBA },
      });
      cookies[k] = r.cookie!;
      void rol;
    }
  });

  it('el administrador da de alta una subcuenta: verifica permisos y guarda el token cifrado', async () => {
    const sim = crearGhlSimulado({
      locationId: LOC,
      token: TOKEN,
      nombre: 'Jade simulada',
      zonaHoraria: 'America/Bogota',
    });
    const ctx = (await cargarContexto(db, ids.admin!))!;
    const r = await darDeAltaSubcuenta(db, ctx, { locationId: LOC, token: TOKEN }, sim.fetch);
    expect(r.nombre).toBe('Jade simulada');
    const [sub] = await db
      .select()
      .from(tablas.subcuentas)
      .where(eq(tablas.subcuentas.locationId, LOC));
    expect(sub?.zonaHoraria).toBe('America/Bogota');
    const [cred] = await db
      .select()
      .from(tablas.credenciales)
      .where(eq(tablas.credenciales.locationId, LOC));
    expect(cred?.tokenCifrado).not.toContain(TOKEN);
    expect(JSON.stringify(await db.select().from(tablas.auditoria))).not.toContain(TOKEN);
  });

  it('si al token le falta un permiso, no guarda nada y dice cuál falta', async () => {
    const sim = crearGhlSimulado({
      locationId: 'LOC_SIN_IA',
      token: TOKEN,
      permisosFaltantes: ['conversation-ai.readonly'],
    });
    const ctx = (await cargarContexto(db, ids.admin!))!;
    await expect(
      darDeAltaSubcuenta(db, ctx, { locationId: 'LOC_SIN_IA', token: TOKEN }, sim.fetch),
    ).rejects.toThrow(/conversation-ai\.readonly/);
    expect(
      await db
        .select()
        .from(tablas.subcuentas)
        .where(eq(tablas.subcuentas.locationId, 'LOC_SIN_IA')),
    ).toHaveLength(0);
  });

  describe('con usuarios por rol', () => {
    beforeAll(async () => {
      await db.insert(tablas.mapaEtapas).values(
        ['Nuevo', 'Contactado', 'Cotizado', 'Adelanto'].map((n, i) => ({
          locationId: LOC,
          pipelineId: 'P1',
          stageId: `S${i}`,
          nombreOriginal: n,
        })),
      );
      ids.dueno = await crearUsuarioPrueba(db, {
        correo: 'dueno@cfg.pe',
        rol: 'dueno',
        subcuentas: [LOC],
      });
      ids.duenoOtra = await crearUsuarioPrueba(db, {
        correo: 'duenootra@cfg.pe',
        rol: 'dueno',
        subcuentas: ['LOC_OTRA'],
      });
      ids.supervisor = await crearUsuarioPrueba(db, {
        correo: 'super@cfg.pe',
        rol: 'supervisor',
        subcuentas: [LOC],
      });
      for (const k of ['dueno', 'duenootra', 'super']) {
        const r = await llamar(ingresarRuta, '/api/auth/ingresar', {
          cuerpo: { correo: `${k}@cfg.pe`, clave: CLAVE_PRUEBA },
        });
        cookies[k] = r.cookie!;
      }
    });

    it('solo el administrador puede dar de alta subcuentas', async () => {
      const r = await llamar(altaRuta, '/api/configuracion/subcuentas', {
        cookie: cookies.dueno,
        cuerpo: { locationId: 'LOC_X1234', token: 'x'.repeat(20) },
      });
      expect(r.estado).toBe(403);
    });

    it('el dueño elige las 3 etapas de calidad de su subcuenta', async () => {
      const r = await llamar(calidadRuta, `/api/subcuentas/${LOC}/etapas-calidad`, {
        metodo: 'PUT',
        cookie: cookies.dueno,
        cuerpo: { etapas: ['S1', 'S2', 'S3'] },
        params: { id: LOC },
      });
      expect(r.estado).toBe(200);
      const [sub] = await db
        .select()
        .from(tablas.subcuentas)
        .where(eq(tablas.subcuentas.locationId, LOC));
      expect(sub?.etapasCalidad).toEqual(['S1', 'S2', 'S3']);
      const reg = (await db.select().from(tablas.auditoria)).find(
        (a) => a.que === 'etapas_calidad',
      );
      expect(reg?.quien).toBe(ids.dueno);
    });

    it('exige exactamente 3 etapas distintas y de la subcuenta', async () => {
      for (const etapas of [
        ['S1', 'S2'],
        ['S1', 'S1', 'S2'],
        ['S1', 'S2', 'NO_EXISTE'],
      ]) {
        const r = await llamar(calidadRuta, `/api/subcuentas/${LOC}/etapas-calidad`, {
          metodo: 'PUT',
          cookie: cookies.dueno,
          cuerpo: { etapas },
          params: { id: LOC },
        });
        expect(r.estado).toBe(400);
      }
    });

    it('el supervisor (solo ver metas) y el dueño de otra subcuenta no pueden', async () => {
      const a = await llamar(calidadRuta, `/api/subcuentas/${LOC}/etapas-calidad`, {
        metodo: 'PUT',
        cookie: cookies.super,
        cuerpo: { etapas: ['S0', 'S1', 'S2'] },
        params: { id: LOC },
      });
      expect(a.estado).toBe(403);
      const b = await llamar(calidadRuta, `/api/subcuentas/${LOC}/etapas-calidad`, {
        metodo: 'PUT',
        cookie: cookies.duenootra,
        cuerpo: { etapas: ['S0', 'S1', 'S2'] },
        params: { id: LOC },
      });
      expect(b.estado).toBe(403);
    });

    it('el mapa de etapas lo edita solo el administrador', async () => {
      const cuerpo = {
        etapas: [
          { stageId: 'S2', etapaEstandar: 'por_cerrar' },
          { stageId: 'S3', etapaEstandar: 'ganado' },
        ],
      };
      const d = await llamar(mapaRuta, `/api/configuracion/subcuentas/${LOC}/mapa-etapas`, {
        metodo: 'PUT',
        cookie: cookies.dueno,
        cuerpo,
        params: { id: LOC },
      });
      expect(d.estado).toBe(403);
      const a = await llamar(mapaRuta, `/api/configuracion/subcuentas/${LOC}/mapa-etapas`, {
        metodo: 'PUT',
        cookie: cookies.admin,
        cuerpo,
        params: { id: LOC },
      });
      expect(a.estado).toBe(200);
      const mapa = await db
        .select()
        .from(tablas.mapaEtapas)
        .where(eq(tablas.mapaEtapas.locationId, LOC));
      expect(mapa.find((m) => m.stageId === 'S3')?.etapaEstandar).toBe('ganado');
    });
  });
});
