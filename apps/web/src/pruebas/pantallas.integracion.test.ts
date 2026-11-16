/**
 * Pruebas de integración de las APIs de la fase 5 (metas, exportar y horarios): permisos por módulo y
 * por subcuenta en el servidor, auditoría y que nada sensible salga en un CSV.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { METAS_POR_DEFECTO, acumuladoVacio } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { POST as ingresarRuta } from '@/app/api/auth/ingresar/route';
import { GET as exportarRuta } from '@/app/api/exportar/route';
import { POST as ausenciaRuta } from '@/app/api/subcuentas/[id]/ausencias/route';
import { PUT as zonaRuta } from '@/app/api/configuracion/subcuentas/[id]/zona/route';
import { PUT as horarioRuta } from '@/app/api/subcuentas/[id]/horarios/route';
import { PUT as modoRuta } from '@/app/api/subcuentas/[id]/modo-tiempo/route';
import { GET as leerMetasRuta, PUT as metasRuta } from '@/app/api/subcuentas/[id]/metas/route';
import { aCsv } from '@/servidor/exportar';
import {
  CLAVE_PRUEBA,
  crearUsuarioPrueba,
  hayBaseDePruebas,
  llamar,
  prepararBase,
} from './entorno';

const RANGO = 'desde=2026-11-01&hasta=2026-11-30';
const metas = { ...METAS_POR_DEFECTO, tiempoRespuestaMin: 8, ventasPorSemana: 5 };

describe('CSV', () => {
  it('neutraliza fórmulas y escapa comas, comillas y saltos de línea', () => {
    const csv = aCsv([
      ['=HYPERLINK("x")', '+1', '-2', '@a', 'normal'],
      ['a,b', 'di "hola"', 'línea\nnueva', 3.14159, null],
    ]);
    expect(csv.startsWith('﻿')).toBe(true);
    const [l1, l2] = csv.slice(1).split('\r\n');
    expect(l1).toBe(`"'=HYPERLINK(""x"")",'+1,'-2,'@a,normal`);
    expect(l2).toBe('"a,b","di ""hola""","línea\nnueva",3.14,');
  });
});

describe.skipIf(!hayBaseDePruebas)('metas, exportar y horarios (integración)', () => {
  let db: Db;
  const cookies: Record<string, string> = {};

  beforeAll(async () => {
    db = await prepararBase();
    await db.insert(tablas.subcuentas).values([
      { locationId: 'LOC_A', nombre: 'Subcuenta A' },
      { locationId: 'LOC_B', nombre: '=Subcuenta B' },
    ]);
    await db.insert(tablas.asesores).values([
      { userId: 'U1', nombre: 'Asesor Uno' },
      { userId: 'U2', nombre: 'Asesor Dos' },
    ]);
    const acumulado = {
      ...acumuladoVacio(),
      leadsRecibidos: 5,
      tiemposRespuesta: [3, 4],
      ventas: 1,
      montoVentas: 100,
    };
    await db.insert(tablas.resumenDiario).values([
      { fecha: '2026-11-10', locationId: 'LOC_A', asesorId: null, indicadores: acumulado },
      { fecha: '2026-11-10', locationId: 'LOC_A', asesorId: 'U1', indicadores: acumulado },
      { fecha: '2026-11-10', locationId: 'LOC_B', asesorId: null, indicadores: acumulado },
    ]);
    await crearUsuarioPrueba(db, { correo: 'admin@prueba.pe', rol: 'admin' });
    await crearUsuarioPrueba(db, {
      correo: 'dueno@prueba.pe',
      rol: 'dueno',
      subcuentas: ['LOC_A'],
    });
    await crearUsuarioPrueba(db, {
      correo: 'super@prueba.pe',
      rol: 'supervisor',
      subcuentas: ['LOC_A'],
    });
    const asesor = await crearUsuarioPrueba(db, {
      correo: 'asesor@prueba.pe',
      rol: 'asesor',
      subcuentas: ['LOC_A'],
      userIdGhl: 'U1',
    });
    // Excepción: este asesor puede editar horarios (solo los propios).
    await db
      .insert(tablas.permisosUsuario)
      .values({ usuarioId: asesor, modulo: 'horarios', nivel: 'editar' });
    for (const k of ['admin', 'dueno', 'super', 'asesor']) {
      const r = await llamar(ingresarRuta, '/api/auth/ingresar', {
        cuerpo: { correo: `${k}@prueba.pe`, clave: CLAVE_PRUEBA },
      });
      expect(r.estado).toBe(200);
      cookies[k] = r.cookie!;
    }
  });

  describe('metas', () => {
    it('el dueño edita las metas de su subcuenta y queda en auditoría', async () => {
      const r = await llamar(metasRuta, '/api/subcuentas/LOC_A/metas', {
        metodo: 'PUT',
        cookie: cookies.dueno,
        cuerpo: metas,
        params: { id: 'LOC_A' },
      });
      expect(r.estado).toBe(200);
      const leidas = await llamar(leerMetasRuta, '/api/subcuentas/LOC_A/metas', {
        cookie: cookies.dueno,
        params: { id: 'LOC_A' },
      });
      expect(leidas.cuerpo.tiempoRespuestaMin).toBe(8);
      expect(leidas.cuerpo.ventasPorSemana).toBe(5);
      const reg = (await db.select().from(tablas.auditoria)).find(
        (a) => a.que === 'metas_guardadas',
      );
      expect(JSON.stringify(reg?.detalle)).toContain('tiempoRespuestaMin');
    });

    it('el dueño no edita las metas de una subcuenta ajena', async () => {
      const r = await llamar(metasRuta, '/api/subcuentas/LOC_B/metas', {
        metodo: 'PUT',
        cookie: cookies.dueno,
        cuerpo: metas,
        params: { id: 'LOC_B' },
      });
      expect(r.estado).toBe(403);
    });

    it('el supervisor solo ve las metas (no las edita) y el asesor no tiene el módulo', async () => {
      expect(
        (
          await llamar(leerMetasRuta, '/api/subcuentas/LOC_A/metas', {
            cookie: cookies.super,
            params: { id: 'LOC_A' },
          })
        ).estado,
      ).toBe(200);
      expect(
        (
          await llamar(metasRuta, '/api/subcuentas/LOC_A/metas', {
            metodo: 'PUT',
            cookie: cookies.super,
            cuerpo: metas,
            params: { id: 'LOC_A' },
          })
        ).estado,
      ).toBe(403);
      expect(
        (
          await llamar(leerMetasRuta, '/api/subcuentas/LOC_A/metas', {
            cookie: cookies.asesor,
            params: { id: 'LOC_A' },
          })
        ).estado,
      ).toBe(403);
    });

    it('rechaza valores fuera de rango o campos desconocidos', async () => {
      for (const cuerpo of [
        { ...metas, calidad: 9 },
        { ...metas, extra: 1 },
        { ...metas, sinResponder: { meta: 3, tolerancia: 1 } },
      ]) {
        const r = await llamar(metasRuta, '/api/subcuentas/LOC_A/metas', {
          metodo: 'PUT',
          cookie: cookies.admin,
          cuerpo,
          params: { id: 'LOC_A' },
        });
        expect(r.estado).toBe(400);
      }
    });
  });

  describe('exportar', () => {
    it('el dueño exporta su vista general solo con sus subcuentas y queda en auditoría', async () => {
      const r = await llamar(exportarRuta, `/api/exportar?tipo=vista-general&${RANGO}`, {
        cookie: cookies.dueno,
      });
      expect(r.estado).toBe(200);
      expect(r.cabeceras.get('content-type')).toContain('text/csv');
      expect(r.texto).toContain('Subcuenta A');
      expect(r.texto).not.toContain('Subcuenta B');
      const reg = (await db.select().from(tablas.auditoria)).filter((a) => a.que === 'exportacion');
      expect(reg.length).toBeGreaterThan(0);
    });

    it('el administrador exporta y los nombres no se interpretan como fórmula', async () => {
      const r = await llamar(exportarRuta, `/api/exportar?tipo=vista-general&${RANGO}`, {
        cookie: cookies.admin,
      });
      expect(r.texto).toContain("'=Subcuenta B");
    });

    it('exportar una subcuenta ajena o sin el módulo responde 403', async () => {
      expect(
        (
          await llamar(exportarRuta, `/api/exportar?tipo=subcuenta&subcuenta=LOC_B&${RANGO}`, {
            cookie: cookies.dueno,
          })
        ).estado,
      ).toBe(403);
      expect(
        (
          await llamar(exportarRuta, `/api/exportar?tipo=subcuenta&subcuenta=LOC_A&${RANGO}`, {
            cookie: cookies.super,
          })
        ).estado,
      ).toBe(403);
    });

    it('la exportación por subcuenta trae una fila por asesor y el total', async () => {
      const r = await llamar(
        exportarRuta,
        `/api/exportar?tipo=subcuenta&subcuenta=LOC_A&${RANGO}`,
        { cookie: cookies.dueno },
      );
      expect(r.estado).toBe(200);
      const lineas = r.texto.trim().split('\r\n');
      expect(lineas).toHaveLength(3);
      expect(lineas[1]).toMatch(/^Asesor Uno,5,/);
      expect(lineas[2]).toMatch(/^Total Subcuenta A,5,/);
    });
  });

  describe('horarios', () => {
    const tramos = [{ diaSemana: 1, inicio: '09:00', fin: '13:00' }];

    it('el asesor con permiso edita solo su propio horario', async () => {
      const propio = await llamar(horarioRuta, '/api/subcuentas/LOC_A/horarios', {
        metodo: 'PUT',
        cookie: cookies.asesor,
        cuerpo: { userId: 'U1', vigenteDesde: '2026-11-20', tramos },
        params: { id: 'LOC_A' },
      });
      expect(propio.estado).toBe(200);
      const ajeno = await llamar(horarioRuta, '/api/subcuentas/LOC_A/horarios', {
        metodo: 'PUT',
        cookie: cookies.asesor,
        cuerpo: { userId: 'U2', vigenteDesde: '2026-11-20', tramos },
        params: { id: 'LOC_A' },
      });
      expect(ajeno.estado).toBe(403);
    });

    it('el asesor no puede cambiar el horario general ni registrar feriados', async () => {
      const general = await llamar(horarioRuta, '/api/subcuentas/LOC_A/horarios', {
        metodo: 'PUT',
        cookie: cookies.asesor,
        cuerpo: { userId: null, vigenteDesde: '2026-11-20', tramos },
        params: { id: 'LOC_A' },
      });
      expect(general.estado).toBe(403);
      const feriado = await llamar(ausenciaRuta, '/api/subcuentas/LOC_A/ausencias', {
        cookie: cookies.asesor,
        cuerpo: {
          userId: null,
          tipo: 'feriado',
          inicio: '2026-12-08T00:00:00-05:00',
          fin: '2026-12-09T00:00:00-05:00',
        },
        params: { id: 'LOC_A' },
      });
      expect(feriado.estado).toBe(403);
    });

    it('el supervisor edita el horario general de su subcuenta pero no el de otra', async () => {
      const r = await llamar(horarioRuta, '/api/subcuentas/LOC_A/horarios', {
        metodo: 'PUT',
        cookie: cookies.super,
        cuerpo: { userId: null, vigenteDesde: '2026-11-20', tramos },
        params: { id: 'LOC_A' },
      });
      expect(r.estado).toBe(200);
      const otra = await llamar(horarioRuta, '/api/subcuentas/LOC_B/horarios', {
        metodo: 'PUT',
        cookie: cookies.super,
        cuerpo: { userId: null, vigenteDesde: '2026-11-20', tramos },
        params: { id: 'LOC_B' },
      });
      expect(otra.estado).toBe(403);
    });
  });

  describe('modo de tiempo y zona horaria', () => {
    const subcuenta = async (id: string) =>
      (await db.select().from(tablas.subcuentas)).find((x) => x.locationId === id)!;

    it('el supervisor cambia a tiempo corrido y se pide recalcular todo el historial', async () => {
      const r = await llamar(modoRuta, '/api/subcuentas/LOC_A/modo-tiempo', {
        metodo: 'PUT',
        cookie: cookies.super,
        cuerpo: { modo: 'corrido' },
        params: { id: 'LOC_A' },
      });
      expect(r.estado).toBe(200);
      expect((await subcuenta('LOC_A')).horarioGeneral).toEqual({
        modo: 'corrido',
        recalcularDesde: '2026-11-10',
      });
      const reg = (await db.select().from(tablas.auditoria)).find((a) => a.que === 'modo_tiempo');
      expect(reg?.detalle).toMatchObject({ antes: 'laboral', despues: 'corrido' });
    });

    it('el asesor (aunque edite horarios), el dueño y una subcuenta ajena no pueden cambiar el modo', async () => {
      expect(
        (
          await llamar(modoRuta, '/api/subcuentas/LOC_A/modo-tiempo', {
            metodo: 'PUT',
            cookie: cookies.asesor,
            cuerpo: { modo: 'laboral' },
            params: { id: 'LOC_A' },
          })
        ).estado,
      ).toBe(403);
      expect(
        (
          await llamar(modoRuta, '/api/subcuentas/LOC_A/modo-tiempo', {
            metodo: 'PUT',
            cookie: cookies.dueno,
            cuerpo: { modo: 'laboral' },
            params: { id: 'LOC_A' },
          })
        ).estado,
      ).toBe(403);
      expect(
        (
          await llamar(modoRuta, '/api/subcuentas/LOC_B/modo-tiempo', {
            metodo: 'PUT',
            cookie: cookies.super,
            cuerpo: { modo: 'laboral' },
            params: { id: 'LOC_B' },
          })
        ).estado,
      ).toBe(403);
      expect(
        (
          await llamar(modoRuta, '/api/subcuentas/LOC_A/modo-tiempo', {
            metodo: 'PUT',
            cookie: cookies.super,
            cuerpo: { modo: 'libre' },
            params: { id: 'LOC_A' },
          })
        ).estado,
      ).toBe(400);
    });

    it('solo el administrador cambia la zona horaria y debe ser una zona válida', async () => {
      expect(
        (
          await llamar(zonaRuta, '/api/configuracion/subcuentas/LOC_B/zona', {
            metodo: 'PUT',
            cookie: cookies.dueno,
            cuerpo: { zonaHoraria: 'America/Lima' },
            params: { id: 'LOC_B' },
          })
        ).estado,
      ).toBe(403);
      expect(
        (
          await llamar(zonaRuta, '/api/configuracion/subcuentas/LOC_B/zona', {
            metodo: 'PUT',
            cookie: cookies.admin,
            cuerpo: { zonaHoraria: 'Lima' },
            params: { id: 'LOC_B' },
          })
        ).estado,
      ).toBe(400);
      const r = await llamar(zonaRuta, '/api/configuracion/subcuentas/LOC_B/zona', {
        metodo: 'PUT',
        cookie: cookies.admin,
        cuerpo: { zonaHoraria: 'America/Bogota' },
        params: { id: 'LOC_B' },
      });
      expect(r.estado).toBe(200);
      const s = await subcuenta('LOC_B');
      expect(s.zonaHoraria).toBe('America/Bogota');
      expect(s.horarioGeneral).toEqual({ recalcularDesde: '2026-11-10' });
    });
  });
});
