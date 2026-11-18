import { beforeAll, describe, expect, it } from 'vitest';
import { acumuladoVacio, type Acumulado } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { POST as ingresarRuta } from '@/app/api/auth/ingresar/route';
import { GET as asesorIndRuta } from '@/app/api/subcuentas/[id]/asesores/[userId]/indicadores/route';
import { POST as ausenciaRuta } from '@/app/api/subcuentas/[id]/ausencias/route';
import { GET as horariosGet, PUT as horariosPut } from '@/app/api/subcuentas/[id]/horarios/route';
import { GET as subIndRuta } from '@/app/api/subcuentas/[id]/indicadores/route';
import { GET as vistaRuta } from '@/app/api/vista-general/route';
import { cargarContexto } from '@/servidor/acceso';
import { asesoresSubcuenta } from '@/servidor/consultas/indicadores';
import {
  CLAVE_PRUEBA,
  crearUsuarioPrueba,
  hayBaseDePruebas,
  llamar,
  prepararBase,
} from './entorno';

const RANGO = '?desde=2026-11-16&hasta=2026-11-17';
const acum = (c: Partial<Acumulado>): Acumulado => ({ ...acumuladoVacio(), ...c });

describe.skipIf(!hayBaseDePruebas)('indicadores y horarios (integración)', () => {
  let db: Db;
  const cookies: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await prepararBase();
    await db.insert(tablas.subcuentas).values([
      { locationId: 'LA', nombre: 'A' },
      { locationId: 'LB', nombre: 'B' },
      { locationId: 'LC', nombre: 'C' },
    ]);
    await db.insert(tablas.asesores).values([
      { userId: 'U1', nombre: 'Asesora Uno' },
      { userId: 'U2', nombre: 'Asesora Dos' },
    ]);
    const r = (
      fecha: string,
      locationId: string,
      asesorId: string | null,
      a: Acumulado,
      canal: string | null = null,
    ) => ({
      fecha,
      locationId,
      asesorId,
      canal,
      indicadores: a,
    });
    await db.insert(tablas.resumenDiario).values([
      r(
        '2026-11-16',
        'LA',
        null,
        acum({ leadsRecibidos: 10, tiemposRespuesta: [1, 2, 3], ventas: 1, fotoSinResponder: 4 }),
      ),
      r(
        '2026-11-17',
        'LA',
        null,
        acum({ leadsRecibidos: 10, tiemposRespuesta: [4], ventas: 1, fotoSinResponder: 2 }),
      ),
      r(
        '2026-11-16',
        'LA',
        'U1',
        acum({ leadsRecibidos: 6, tiemposRespuesta: [1, 2], fotoSinResponder: 3 }),
      ),
      r(
        '2026-11-16',
        'LA',
        'U2',
        acum({ leadsRecibidos: 4, tiemposRespuesta: [3], ventas: 1, fotoSinResponder: 1 }),
      ),
      r('2026-11-16', 'LB', null, acum({ leadsRecibidos: 5, tiemposRespuesta: [100], ventas: 3 })),
      r('2026-11-16', 'LC', null, acum({ leadsRecibidos: 1000, ventas: 500 })),
      // Totales por canal (no deben sumarse al total de todos los canales).
      r('2026-11-16', 'LA', null, acum({ leadsRecibidos: 7, ventas: 1 }), 'whatsapp'),
      r('2026-11-16', 'LA', null, acum({ leadsRecibidos: 3 }), 'instagram'),
      r('2026-11-16', 'LC', null, acum({ leadsRecibidos: 1000, ventas: 500 }), 'whatsapp'),
    ]);
    await crearUsuarioPrueba(db, { correo: 'admin@ind.pe', rol: 'admin' });
    ids.dueno = await crearUsuarioPrueba(db, {
      correo: 'dueno@ind.pe',
      rol: 'dueno',
      subcuentas: ['LA', 'LB'],
    });
    ids.super = await crearUsuarioPrueba(db, {
      correo: 'super@ind.pe',
      rol: 'supervisor',
      subcuentas: ['LA'],
    });
    ids.asesor = await crearUsuarioPrueba(db, {
      correo: 'asesor@ind.pe',
      rol: 'asesor',
      subcuentas: ['LA'],
      userIdGhl: 'U1',
    });
    for (const k of ['admin', 'dueno', 'super', 'asesor']) {
      cookies[k] = (
        await llamar(ingresarRuta, '/api/auth/ingresar', {
          cuerpo: { correo: `${k}@ind.pe`, clave: CLAVE_PRUEBA },
        })
      ).cookie!;
    }
  });

  it('la vista general del dueño suma solo sus subcuentas', async () => {
    const r = await llamar(vistaRuta, `/api/vista-general${RANGO}`, { cookie: cookies.dueno });
    expect(r.estado).toBe(200);
    const ind = r.cuerpo.indicadores as {
      leadsRecibidos: number;
      ventas: number;
      tiempoRespuestaMediana: number;
    };
    expect(ind.leadsRecibidos).toBe(25); // A (20) + B (5); nunca C
    expect(ind.ventas).toBe(5);
    // Mediana sobre todos los registros [1,2,3,4,100] = 3, no promedio de medianas.
    expect(ind.tiempoRespuestaMediana).toBe(3);
    expect(
      (r.cuerpo.subcuentas as { locationId: string }[]).map((s) => s.locationId).sort(),
    ).toEqual(['LA', 'LB']);
  });

  it('filtro por canal: solo las filas de ese canal, de las subcuentas del usuario', async () => {
    const r = await llamar(vistaRuta, `/api/vista-general${RANGO}&canal=instagram`, {
      cookie: cookies.dueno,
    });
    expect(r.estado).toBe(200);
    expect((r.cuerpo.indicadores as { leadsRecibidos: number }).leadsRecibidos).toBe(3);
    expect(r.cuerpo.canal).toBe('instagram');
    // Opciones: los canales con datos en sus subcuentas (LA); C es ajena, pero también es whatsapp.
    expect(r.cuerpo.canales).toEqual(['instagram', 'whatsapp']);
    const w = await llamar(vistaRuta, `/api/vista-general${RANGO}&canal=whatsapp`, {
      cookie: cookies.dueno,
    });
    expect((w.cuerpo.indicadores as { leadsRecibidos: number }).leadsRecibidos).toBe(7); // nunca C
    // Un valor raro se ignora y vuelve al total.
    const x = await llamar(vistaRuta, `/api/vista-general${RANGO}&canal=';drop`, {
      cookie: cookies.dueno,
    });
    expect((x.cuerpo.indicadores as { leadsRecibidos: number }).leadsRecibidos).toBe(25);
  });

  it('el administrador ve todas; el supervisor no tiene vista general', async () => {
    const a = await llamar(vistaRuta, `/api/vista-general${RANGO}`, { cookie: cookies.admin });
    expect((a.cuerpo.indicadores as { leadsRecibidos: number }).leadsRecibidos).toBe(1025);
    expect(
      (await llamar(vistaRuta, `/api/vista-general${RANGO}`, { cookie: cookies.super })).estado,
    ).toBe(403);
  });

  it('indicadores de subcuenta: total, asesores y foto del último día', async () => {
    const r = await llamar(subIndRuta, `/api/subcuentas/LA/indicadores${RANGO}`, {
      cookie: cookies.super,
      params: { id: 'LA' },
    });
    expect(r.estado).toBe(200);
    const ind = r.cuerpo.indicadores as {
      leadsRecibidos: number;
      sinResponder: number;
      conversion: number;
    };
    expect(ind.leadsRecibidos).toBe(20);
    expect(ind.sinResponder).toBe(2); // foto del 17, no suma de días
    expect(ind.conversion).toBe(10);
    expect((r.cuerpo.asesores as { nombre: string }[]).map((a) => a.nombre).sort()).toEqual([
      'Asesora Dos',
      'Asesora Uno',
    ]);
    expect(r.cuerpo.evaluacion).toHaveProperty('cuello');
  });

  it('módulo Asesores: asesores de la subcuenta con su permiso, nunca de una ajena', async () => {
    const ctx = async (k: string) => (await cargarContexto(db, ids[k]!))!;
    const r = await asesoresSubcuenta(db, await ctx('super'), 'LA', '2026-11-16', '2026-11-17');
    expect(r.asesores.map((a) => a.nombre).sort()).toEqual(['Asesora Dos', 'Asesora Uno']);
    await expect(
      asesoresSubcuenta(db, await ctx('super'), 'LB', '2026-11-16', '2026-11-17'),
    ).rejects.toMatchObject({ estado: 403 });
    // El asesor solo ve su propia fila.
    const propio = await asesoresSubcuenta(
      db,
      await ctx('asesor'),
      'LA',
      '2026-11-16',
      '2026-11-17',
    );
    expect(propio.asesores.map((a) => a.asesorId)).toEqual(['U1']);
    // Sin el permiso de detalle de asesores, nada.
    await db
      .insert(tablas.permisosUsuario)
      .values({ usuarioId: ids.dueno!, modulo: 'detalle_asesores', nivel: 'ninguno' });
    await expect(
      asesoresSubcuenta(db, await ctx('dueno'), 'LA', '2026-11-16', '2026-11-17'),
    ).rejects.toMatchObject({ estado: 403 });
    await db.delete(tablas.permisosUsuario);
  });

  it('nadie lee indicadores de una subcuenta ajena', async () => {
    expect(
      (
        await llamar(subIndRuta, `/api/subcuentas/LC/indicadores${RANGO}`, {
          cookie: cookies.dueno,
          params: { id: 'LC' },
        })
      ).estado,
    ).toBe(403);
    expect(
      (
        await llamar(subIndRuta, `/api/subcuentas/LB/indicadores${RANGO}`, {
          cookie: cookies.super,
          params: { id: 'LB' },
        })
      ).estado,
    ).toBe(403);
  });

  it('el asesor solo ve sus propios indicadores, con el promedio de la subcuenta para comparar', async () => {
    const propio = await llamar(
      asesorIndRuta,
      `/api/subcuentas/LA/asesores/U1/indicadores${RANGO}`,
      { cookie: cookies.asesor, params: { id: 'LA', userId: 'U1' } },
    );
    expect(propio.estado).toBe(200);
    expect((propio.cuerpo.indicadores as { leadsRecibidos: number }).leadsRecibidos).toBe(6);
    expect((propio.cuerpo.subcuenta as { leadsRecibidos: number }).leadsRecibidos).toBe(20);
    const ajeno = await llamar(
      asesorIndRuta,
      `/api/subcuentas/LA/asesores/U2/indicadores${RANGO}`,
      { cookie: cookies.asesor, params: { id: 'LA', userId: 'U2' } },
    );
    expect(ajeno.estado).toBe(403);
    expect(
      (
        await llamar(subIndRuta, `/api/subcuentas/LA/indicadores${RANGO}`, {
          cookie: cookies.asesor,
          params: { id: 'LA' },
        })
      ).estado,
    ).toBe(403);
  });

  describe('horarios y ausencias', () => {
    const horario = {
      userId: null,
      vigenteDesde: '2026-01-01',
      tramos: [1, 2, 3, 4, 5].flatMap((d) => [
        { diaSemana: d, inicio: '09:00', fin: '13:00' },
        { diaSemana: d, inicio: '14:00', fin: '18:00' },
      ]),
    };

    it('el supervisor guarda el horario general; el dueño solo lo ve', async () => {
      const d = await llamar(horariosPut, '/api/subcuentas/LA/horarios', {
        metodo: 'PUT',
        cookie: cookies.dueno,
        cuerpo: horario,
        params: { id: 'LA' },
      });
      expect(d.estado).toBe(403);
      const s = await llamar(horariosPut, '/api/subcuentas/LA/horarios', {
        metodo: 'PUT',
        cookie: cookies.super,
        cuerpo: horario,
        params: { id: 'LA' },
      });
      expect(s.estado).toBe(200);
      const g = await llamar(horariosGet, '/api/subcuentas/LA/horarios', {
        cookie: cookies.dueno,
        params: { id: 'LA' },
      });
      expect((g.cuerpo.horarios as unknown[]).length).toBe(10);
    });

    it('un horario nuevo cierra la vigencia del anterior', async () => {
      const nuevo = {
        ...horario,
        vigenteDesde: '2026-12-01',
        tramos: [{ diaSemana: 1, inicio: '08:00', fin: '16:00' }],
      };
      await llamar(horariosPut, '/api/subcuentas/LA/horarios', {
        metodo: 'PUT',
        cookie: cookies.super,
        cuerpo: nuevo,
        params: { id: 'LA' },
      });
      const g = await llamar(horariosGet, '/api/subcuentas/LA/horarios', {
        cookie: cookies.super,
        params: { id: 'LA' },
      });
      const filas = g.cuerpo.horarios as { vigente_desde: string; vigente_hasta: string | null }[];
      expect(filas.filter((f) => String(f.vigente_hasta).startsWith('2026-11-30'))).toHaveLength(
        10,
      );
      expect(filas.filter((f) => f.vigente_hasta === null)).toHaveLength(1);
    });

    it('rechaza tramos superpuestos o invertidos', async () => {
      for (const tramos of [
        [
          { diaSemana: 1, inicio: '09:00', fin: '13:00' },
          { diaSemana: 1, inicio: '12:00', fin: '15:00' },
        ],
        [{ diaSemana: 1, inicio: '13:00', fin: '09:00' }],
      ]) {
        const r = await llamar(horariosPut, '/api/subcuentas/LA/horarios', {
          metodo: 'PUT',
          cookie: cookies.super,
          cuerpo: { ...horario, tramos },
          params: { id: 'LA' },
        });
        expect(r.estado).toBe(400);
      }
    });

    it('el asesor no edita horarios ni registra ausencias', async () => {
      const r = await llamar(ausenciaRuta, '/api/subcuentas/LA/ausencias', {
        cookie: cookies.asesor,
        cuerpo: {
          userId: 'U1',
          inicio: '2026-12-01T00:00:00-05:00',
          fin: '2026-12-05T00:00:00-05:00',
          tipo: 'vacaciones',
        },
        params: { id: 'LA' },
      });
      expect(r.estado).toBe(403);
    });

    it('un feriado aplica a toda la subcuenta', async () => {
      const mal = await llamar(ausenciaRuta, '/api/subcuentas/LA/ausencias', {
        cookie: cookies.super,
        cuerpo: {
          userId: 'U1',
          inicio: '2026-12-08T00:00:00-05:00',
          fin: '2026-12-09T00:00:00-05:00',
          tipo: 'feriado',
        },
        params: { id: 'LA' },
      });
      expect(mal.estado).toBe(400);
      const bien = await llamar(ausenciaRuta, '/api/subcuentas/LA/ausencias', {
        cookie: cookies.super,
        cuerpo: {
          userId: null,
          inicio: '2026-12-08T00:00:00-05:00',
          fin: '2026-12-09T00:00:00-05:00',
          tipo: 'feriado',
          motivo: 'Inmaculada Concepción',
        },
        params: { id: 'LA' },
      });
      expect(bien.estado).toBe(201);
    });
  });
});
