import { beforeAll, describe, expect, it } from 'vitest';
import { tablas, type Db } from '@driven/db';
import { POST as confirmar2fa } from '@/app/api/auth/2fa/confirmar/route';
import { POST as configurar2fa } from '@/app/api/auth/2fa/configurar/route';
import { POST as verificar2fa } from '@/app/api/auth/2fa/verificar/route';
import { POST as cambiarClaveRuta } from '@/app/api/auth/cambiar-clave/route';
import { POST as ingresarRuta } from '@/app/api/auth/ingresar/route';
import { POST as salirRuta } from '@/app/api/auth/salir/route';
import { GET as subcuentasRuta } from '@/app/api/subcuentas/route';
import { GET as yoRuta } from '@/app/api/yo/route';
import { crearAdministrador } from '@/servidor/crear-admin';
import { codigoTotp } from '@/servidor/totp';
import {
  CLAVE_PRUEBA,
  crearUsuarioPrueba,
  hayBaseDePruebas,
  llamar,
  prepararBase,
} from './entorno';

const ingresar = (correo: string, clave = CLAVE_PRUEBA) =>
  llamar(ingresarRuta, '/api/auth/ingresar', { cuerpo: { correo, clave } });

describe.skipIf(!hayBaseDePruebas)('autenticación (integración)', () => {
  let db: Db;

  beforeAll(async () => {
    db = await prepararBase();
    await db.insert(tablas.subcuentas).values({ locationId: 'LOC_A', nombre: 'A' });
  });

  it('rechaza una contraseña incorrecta y un correo inexistente con el mismo mensaje', async () => {
    await crearUsuarioPrueba(db, { correo: 'ana@prueba.pe', rol: 'dueno', subcuentas: ['LOC_A'] });
    const a = await ingresar('ana@prueba.pe', 'mala');
    const b = await ingresar('nadie@prueba.pe', 'mala');
    expect(a.estado).toBe(401);
    expect(b.estado).toBe(401);
    expect(a.cuerpo.error).toBe(b.cuerpo.error);
    expect(a.cookie).toBeUndefined();
  });

  it('el correo no distingue mayúsculas', async () => {
    const r = await ingresar('  ANA@Prueba.pe ');
    expect(r.estado).toBe(200);
  });

  it('la cookie de sesión es httpOnly y SameSite=Lax', async () => {
    const req = new Request('http://localhost:3100/api/auth/ingresar', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: 'localhost:3100' },
      body: JSON.stringify({ correo: 'ana@prueba.pe', clave: CLAVE_PRUEBA }),
    });
    const res = await ingresarRuta(req);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=lax/i);
  });

  it('bloquea temporalmente tras 5 intentos fallidos', async () => {
    await crearUsuarioPrueba(db, { correo: 'beto@prueba.pe', rol: 'dueno' });
    for (let i = 0; i < 5; i++) expect((await ingresar('beto@prueba.pe', 'mala')).estado).toBe(401);
    const r = await ingresar('beto@prueba.pe');
    expect(r.estado).toBe(429);
  });

  it('cerrar sesión invalida la cookie', async () => {
    const { cookie } = await ingresar('ana@prueba.pe');
    await llamar(salirRuta, '/api/auth/salir', { cookie, cuerpo: {} });
    expect((await llamar(yoRuta, '/api/yo', { cookie })).estado).toBe(401);
  });

  it('obliga a cambiar la contraseña temporal antes de usar el sistema', async () => {
    await crearUsuarioPrueba(db, {
      correo: 'carla@prueba.pe',
      rol: 'dueno',
      subcuentas: ['LOC_A'],
      debeCambiarClave: true,
    });
    const r = await ingresar('carla@prueba.pe');
    expect(r.cuerpo.debeCambiarClave).toBe(true);
    const bloqueada = await llamar(subcuentasRuta, '/api/subcuentas', { cookie: r.cookie });
    expect(bloqueada.estado).toBe(403);
    expect(bloqueada.cuerpo.codigo).toBe('debe_cambiar_clave');

    const debil = await llamar(cambiarClaveRuta, '/api/auth/cambiar-clave', {
      cookie: r.cookie,
      cuerpo: { claveActual: CLAVE_PRUEBA, claveNueva: 'corta' },
    });
    expect(debil.estado).toBe(400);

    const ok = await llamar(cambiarClaveRuta, '/api/auth/cambiar-clave', {
      cookie: r.cookie,
      cuerpo: { claveActual: CLAVE_PRUEBA, claveNueva: 'NuevaClave2026' },
    });
    expect(ok.estado).toBe(200);
    expect((await llamar(subcuentasRuta, '/api/subcuentas', { cookie: r.cookie })).estado).toBe(
      200,
    );
    expect((await ingresar('carla@prueba.pe', 'NuevaClave2026')).estado).toBe(200);
  });

  it('con 2FA activo exige el código antes de dar acceso', async () => {
    await crearUsuarioPrueba(db, { correo: 'dani@prueba.pe', rol: 'dueno', subcuentas: ['LOC_A'] });
    const { cookie } = await ingresar('dani@prueba.pe');
    const conf = await llamar(configurar2fa, '/api/auth/2fa/configurar', { cookie, cuerpo: {} });
    const secreto = conf.cuerpo.secreto as string;
    expect(conf.cuerpo.uri).toContain('otpauth://totp/');

    const mal = await llamar(confirmar2fa, '/api/auth/2fa/confirmar', {
      cookie,
      cuerpo: { secreto, codigo: '000000' },
    });
    expect(mal.estado).toBe(400);
    const ok = await llamar(confirmar2fa, '/api/auth/2fa/confirmar', {
      cookie,
      cuerpo: { secreto, codigo: codigoTotp(secreto) },
    });
    expect(ok.estado).toBe(200);

    const [u] = (await db.select().from(tablas.usuarios)).filter(
      (x) => x.correo === 'dani@prueba.pe',
    );
    expect(u?.totpSecretoCifrado).not.toContain(secreto);

    const nuevo = await ingresar('dani@prueba.pe');
    expect(nuevo.cuerpo.requiere2fa).toBe(true);
    const pendiente = await llamar(subcuentasRuta, '/api/subcuentas', { cookie: nuevo.cookie });
    expect(pendiente.estado).toBe(401);
    expect(pendiente.cuerpo.codigo).toBe('requiere_2fa');

    expect(
      (
        await llamar(verificar2fa, '/api/auth/2fa/verificar', {
          cookie: nuevo.cookie,
          cuerpo: { codigo: '123456' },
        })
      ).estado,
    ).toBe(401);
    const v = await llamar(verificar2fa, '/api/auth/2fa/verificar', {
      cookie: nuevo.cookie,
      cuerpo: { codigo: codigoTotp(secreto) },
    });
    expect(v.estado).toBe(200);
    expect((await llamar(subcuentasRuta, '/api/subcuentas', { cookie: nuevo.cookie })).estado).toBe(
      200,
    );
  });

  it('crear-admin crea el primer administrador con contraseña temporal', async () => {
    const { claveTemporal } = await crearAdministrador(db, {
      correo: 'Primer.Admin@Driven.pe',
      nombre: 'Primer Admin',
    });
    const r = await ingresar('primer.admin@driven.pe', claveTemporal);
    expect(r.estado).toBe(200);
    expect(r.cuerpo.debeCambiarClave).toBe(true);
    await expect(
      crearAdministrador(db, { correo: 'primer.admin@driven.pe', nombre: 'Otra vez' }),
    ).rejects.toThrow(/Ya existe/);
    const registro = (await db.select().from(tablas.auditoria)).find(
      (a) => a.que === 'admin_creado',
    );
    expect(registro).toBeDefined();
    expect(JSON.stringify(registro)).not.toContain(claveTemporal);
  });

  it('registra los ingresos y los intentos fallidos en la auditoría', async () => {
    const eventos = (await db.select().from(tablas.auditoria)).map((a) => a.que);
    expect(eventos).toContain('ingreso');
    expect(eventos).toContain('ingreso_fallido');
    expect(eventos).toContain('clave_cambiada');
    expect(eventos).toContain('2fa_activado');
  });
});
