/**
 * Pruebas de integración de permisos (§10.1, §12): el filtro por subcuenta se aplica en el servidor
 * aunque el usuario cambie la URL o llame la API directamente.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { tablas, type Db } from '@driven/db';
import { POST as ingresarRuta } from '@/app/api/auth/ingresar/route';
import { POST as calidadRuta } from '@/app/api/calidad/analisis/route';
import { GET as subcuentasRuta } from '@/app/api/subcuentas/route';
import { GET as subcuentaRuta } from '@/app/api/subcuentas/[id]/route';
import { GET as asesorRuta } from '@/app/api/subcuentas/[id]/asesores/[userId]/route';
import { GET as usuariosRuta, POST as crearUsuarioRuta } from '@/app/api/usuarios/route';
import { PATCH as editarUsuarioRuta } from '@/app/api/usuarios/[id]/route';
import {
  CLAVE_PRUEBA,
  crearUsuarioPrueba,
  hayBaseDePruebas,
  llamar,
  prepararBase,
} from './entorno';

const RANGO = '?desde=2026-11-01&hasta=2026-11-30';

describe.skipIf(!hayBaseDePruebas)('permisos por subcuenta (integración)', () => {
  let db: Db;
  const ids: Record<string, string> = {};
  const cookies: Record<string, string> = {};

  async function entrar(correo: string): Promise<string> {
    const r = await llamar(ingresarRuta, '/api/auth/ingresar', {
      cuerpo: { correo, clave: CLAVE_PRUEBA },
    });
    expect(r.estado).toBe(200);
    return r.cookie!;
  }

  beforeAll(async () => {
    db = await prepararBase();
    await db.insert(tablas.subcuentas).values([
      { locationId: 'LOC_A', nombre: 'Subcuenta A' },
      { locationId: 'LOC_B', nombre: 'Subcuenta B' },
      { locationId: 'LOC_C', nombre: 'Subcuenta C' },
    ]);
    const fila = (locationId: string, asesorId: string | null, valor: number) => ({
      fecha: '2026-11-10',
      locationId,
      asesorId,
      indicadores: { leads: valor },
    });
    await db
      .insert(tablas.resumenDiario)
      .values([
        fila('LOC_A', null, 10),
        fila('LOC_B', null, 20),
        fila('LOC_C', null, 30),
        fila('LOC_A', 'U1', 4),
        fila('LOC_A', 'U2', 6),
        fila('LOC_B', 'U1', 9),
      ]);

    ids.admin = await crearUsuarioPrueba(db, { correo: 'admin@prueba.pe', rol: 'admin' });
    ids.dueno = await crearUsuarioPrueba(db, {
      correo: 'dueno@prueba.pe',
      rol: 'dueno',
      subcuentas: ['LOC_A'],
    });
    ids.dueno2 = await crearUsuarioPrueba(db, {
      correo: 'dueno2@prueba.pe',
      rol: 'dueno',
      subcuentas: ['LOC_A', 'LOC_C'],
    });
    ids.supervisor = await crearUsuarioPrueba(db, {
      correo: 'super@prueba.pe',
      rol: 'supervisor',
      subcuentas: ['LOC_B'],
    });
    ids.asesor = await crearUsuarioPrueba(db, {
      correo: 'asesor@prueba.pe',
      rol: 'asesor',
      subcuentas: ['LOC_A'],
      userIdGhl: 'U1',
    });
    for (const k of ['admin', 'dueno', 'dueno2', 'supervisor', 'asesor']) {
      cookies[k] = await entrar(`${k === 'supervisor' ? 'super' : k}@prueba.pe`);
    }
  });

  it('sin sesión responde 401', async () => {
    const r = await llamar(subcuentasRuta, '/api/subcuentas');
    expect(r.estado).toBe(401);
  });

  it('el dueño solo lista sus subcuentas', async () => {
    const r = await llamar(subcuentasRuta, '/api/subcuentas', { cookie: cookies.dueno });
    expect(r.estado).toBe(200);
    expect((r.cuerpo.subcuentas as { locationId: string }[]).map((s) => s.locationId)).toEqual([
      'LOC_A',
    ]);
  });

  it('un dueño con varias subcuentas ve solo esas', async () => {
    const r = await llamar(subcuentasRuta, '/api/subcuentas', { cookie: cookies.dueno2 });
    expect((r.cuerpo.subcuentas as { locationId: string }[]).map((s) => s.locationId)).toEqual([
      'LOC_A',
      'LOC_C',
    ]);
  });

  it('el administrador ve todas las subcuentas', async () => {
    const r = await llamar(subcuentasRuta, '/api/subcuentas', { cookie: cookies.admin });
    expect((r.cuerpo.subcuentas as unknown[]).length).toBe(3);
  });

  it('el dueño puede leer su subcuenta y recibe solo sus datos', async () => {
    const r = await llamar(subcuentaRuta, `/api/subcuentas/LOC_A${RANGO}`, {
      cookie: cookies.dueno,
      params: { id: 'LOC_A' },
    });
    expect(r.estado).toBe(200);
    const filas = r.cuerpo.resumen as { locationId: string; asesorId: string | null }[];
    expect(filas).toHaveLength(1);
    expect(filas.every((f) => f.locationId === 'LOC_A' && f.asesorId === null)).toBe(true);
  });

  it('el dueño NO puede leer una subcuenta ajena cambiando la URL', async () => {
    for (const id of ['LOC_B', 'LOC_C']) {
      const r = await llamar(subcuentaRuta, `/api/subcuentas/${id}${RANGO}`, {
        cookie: cookies.dueno,
        params: { id },
      });
      expect(r.estado).toBe(403);
      expect(JSON.stringify(r.cuerpo)).not.toContain('"leads"');
    }
  });

  it('una subcuenta inexistente responde 403 (no revela si existe)', async () => {
    const r = await llamar(subcuentaRuta, `/api/subcuentas/NO_EXISTE${RANGO}`, {
      cookie: cookies.dueno,
      params: { id: 'NO_EXISTE' },
    });
    expect(r.estado).toBe(403);
  });

  it('el dueño NO puede leer el detalle de un asesor de otra subcuenta', async () => {
    const r = await llamar(asesorRuta, `/api/subcuentas/LOC_B/asesores/U1${RANGO}`, {
      cookie: cookies.dueno,
      params: { id: 'LOC_B', userId: 'U1' },
    });
    expect(r.estado).toBe(403);
  });

  it('el asesor solo ve su propio detalle', async () => {
    const propio = await llamar(asesorRuta, `/api/subcuentas/LOC_A/asesores/U1${RANGO}`, {
      cookie: cookies.asesor,
      params: { id: 'LOC_A', userId: 'U1' },
    });
    expect(propio.estado).toBe(200);
    expect((propio.cuerpo.resumen as { asesorId: string }[]).map((f) => f.asesorId)).toEqual([
      'U1',
    ]);

    const ajeno = await llamar(asesorRuta, `/api/subcuentas/LOC_A/asesores/U2${RANGO}`, {
      cookie: cookies.asesor,
      params: { id: 'LOC_A', userId: 'U2' },
    });
    expect(ajeno.estado).toBe(403);

    // Su propio userId en una subcuenta que no tiene asignada tampoco.
    const otraSubcuenta = await llamar(asesorRuta, `/api/subcuentas/LOC_B/asesores/U1${RANGO}`, {
      cookie: cookies.asesor,
      params: { id: 'LOC_B', userId: 'U1' },
    });
    expect(otraSubcuenta.estado).toBe(403);
  });

  it('el asesor no tiene la vista por subcuenta', async () => {
    const r = await llamar(subcuentaRuta, `/api/subcuentas/LOC_A${RANGO}`, {
      cookie: cookies.asesor,
      params: { id: 'LOC_A' },
    });
    expect(r.estado).toBe(403);
  });

  it('solo el administrador accede a usuarios y accesos', async () => {
    for (const k of ['dueno', 'supervisor', 'asesor']) {
      const r = await llamar(usuariosRuta, '/api/usuarios', { cookie: cookies[k] });
      expect(r.estado).toBe(403);
    }
    const r = await llamar(usuariosRuta, '/api/usuarios', { cookie: cookies.admin });
    expect(r.estado).toBe(200);
  });

  it('un dueño no puede crearse usuarios ni darse subcuentas', async () => {
    const r = await llamar(editarUsuarioRuta, `/api/usuarios/${ids.dueno}`, {
      metodo: 'PATCH',
      cookie: cookies.dueno,
      cuerpo: { subcuentas: ['LOC_A', 'LOC_B'] },
      params: { id: ids.dueno! },
    });
    expect(r.estado).toBe(403);
    const c = await llamar(crearUsuarioRuta, '/api/usuarios', {
      cookie: cookies.dueno,
      cuerpo: { correo: 'x@prueba.pe', nombre: 'X', rol: 'admin' },
    });
    expect(c.estado).toBe(403);
  });

  it('los cambios de subcuentas se aplican en la siguiente petición, sin volver a entrar', async () => {
    const quitar = await llamar(editarUsuarioRuta, `/api/usuarios/${ids.dueno2}`, {
      metodo: 'PATCH',
      cookie: cookies.admin,
      cuerpo: { subcuentas: ['LOC_C'] },
      params: { id: ids.dueno2! },
    });
    expect(quitar.estado).toBe(200);
    const r = await llamar(subcuentaRuta, `/api/subcuentas/LOC_A${RANGO}`, {
      cookie: cookies.dueno2,
      params: { id: 'LOC_A' },
    });
    expect(r.estado).toBe(403);

    const [registro] = (await db.select().from(tablas.auditoria)).filter(
      (a) => a.que === 'usuario_actualizado',
    );
    expect(registro?.quien).toBe(ids.admin);
    expect(JSON.stringify(registro?.detalle)).toContain('LOC_A');
  });

  it('una excepción por usuario quita un módulo del rol', async () => {
    const r1 = await llamar(subcuentaRuta, `/api/subcuentas/LOC_B${RANGO}`, {
      cookie: cookies.supervisor,
      params: { id: 'LOC_B' },
    });
    expect(r1.estado).toBe(200);
    await llamar(editarUsuarioRuta, `/api/usuarios/${ids.supervisor}`, {
      metodo: 'PATCH',
      cookie: cookies.admin,
      cuerpo: { excepciones: { vista_subcuenta: 'ninguno' } },
      params: { id: ids.supervisor! },
    });
    const r2 = await llamar(subcuentaRuta, `/api/subcuentas/LOC_B${RANGO}`, {
      cookie: cookies.supervisor,
      params: { id: 'LOC_B' },
    });
    expect(r2.estado).toBe(403);
  });

  it('no se puede degradar al último administrador', async () => {
    const r = await llamar(editarUsuarioRuta, `/api/usuarios/${ids.admin}`, {
      metodo: 'PATCH',
      cookie: cookies.admin,
      cuerpo: { rol: 'dueno' },
      params: { id: ids.admin! },
    });
    expect(r.estado).toBe(409);
  });

  it('un asesor debe quedar vinculado a su usuario de GHL', async () => {
    const r = await llamar(crearUsuarioRuta, '/api/usuarios', {
      cookie: cookies.admin,
      cuerpo: { correo: 'nuevo@prueba.pe', nombre: 'Nuevo', rol: 'asesor', subcuentas: ['LOC_A'] },
    });
    expect(r.estado).toBe(400);
  });

  it('desactivar un usuario cierra su sesión', async () => {
    const id = await crearUsuarioPrueba(db, {
      correo: 'temporal@prueba.pe',
      rol: 'dueno',
      subcuentas: ['LOC_A'],
    });
    const cookie = await entrar('temporal@prueba.pe');
    await llamar(editarUsuarioRuta, `/api/usuarios/${id}`, {
      metodo: 'PATCH',
      cookie: cookies.admin,
      cuerpo: { activo: false },
      params: { id },
    });
    const r = await llamar(subcuentasRuta, '/api/subcuentas', { cookie });
    expect(r.estado).toBe(401);
  });

  it('rechaza peticiones de otro origen (CSRF)', async () => {
    const r = await llamar(editarUsuarioRuta, `/api/usuarios/${ids.dueno}`, {
      metodo: 'PATCH',
      cookie: cookies.admin,
      cuerpo: { nombre: 'Hackeado' },
      params: { id: ids.dueno! },
      origen: 'https://sitio-malicioso.com',
    });
    expect(r.estado).toBe(403);
  });

  describe('análisis de calidad: solo administrador y con revalidación', () => {
    const cuerpo = { subcuentas: ['LOC_A'], desde: '2026-10-01', hasta: '2026-10-31' };

    it('rechaza a dueño, supervisor y asesor aunque envíen la contraseña', async () => {
      for (const k of ['dueno', 'supervisor', 'asesor']) {
        const r = await llamar(calidadRuta, '/api/calidad/analisis', {
          cookie: cookies[k],
          cuerpo: { ...cuerpo, clave: CLAVE_PRUEBA },
        });
        expect(r.estado).toBe(403);
      }
    });

    it('exige al administrador volver a ingresar su contraseña', async () => {
      const sinClave = await llamar(calidadRuta, '/api/calidad/analisis', {
        cookie: cookies.admin,
        cuerpo,
      });
      expect(sinClave.estado).toBe(401);
      const malClave = await llamar(calidadRuta, '/api/calidad/analisis', {
        cookie: cookies.admin,
        cuerpo: { ...cuerpo, clave: 'incorrecta' },
      });
      expect(malClave.estado).toBe(401);
      const conClave = await llamar(calidadRuta, '/api/calidad/analisis', {
        cookie: cookies.admin,
        cuerpo: { ...cuerpo, clave: CLAVE_PRUEBA },
      });
      // Autorizado: llega a la validación de negocio (LOC_A no tiene sus 3 etapas de calidad).
      expect(conClave.estado).toBe(400);
      expect(conClave.cuerpo.error).toMatch(/3 etapas/);
    });
  });
});
