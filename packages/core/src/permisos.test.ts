import { describe, expect, it } from 'vitest';
import {
  MATRIZ_POR_DEFECTO,
  MODULOS,
  alcanzaNivel,
  nivelesEfectivos,
  validarCambioAdmin,
} from './permisos';

describe('matriz por defecto (§10.1)', () => {
  it('define todos los módulos para cada rol', () => {
    for (const rol of Object.keys(MATRIZ_POR_DEFECTO) as (keyof typeof MATRIZ_POR_DEFECTO)[]) {
      expect(Object.keys(MATRIZ_POR_DEFECTO[rol]).sort()).toEqual([...MODULOS].sort());
    }
  });

  it('coincide con la tabla de la especificación', () => {
    expect(MATRIZ_POR_DEFECTO.dueno.metas).toBe('editar');
    expect(MATRIZ_POR_DEFECTO.dueno.configuracion).toBe('ninguno');
    expect(MATRIZ_POR_DEFECTO.supervisor.vista_general).toBe('ninguno');
    expect(MATRIZ_POR_DEFECTO.supervisor.horarios).toBe('editar');
    expect(MATRIZ_POR_DEFECTO.asesor.vista_subcuenta).toBe('ninguno');
    expect(MATRIZ_POR_DEFECTO.asesor.detalle_asesores).toBe('ver');
    expect(MATRIZ_POR_DEFECTO.admin.texto_mensajes).toBe('ver');
    expect(MATRIZ_POR_DEFECTO.admin.exportar).toBe('ver');
  });
});

describe('nivelesEfectivos', () => {
  it('sin excepciones usa el rol', () => {
    expect(nivelesEfectivos('supervisor')).toEqual(MATRIZ_POR_DEFECTO.supervisor);
  });

  it('la excepción por usuario reemplaza al rol, para dar o quitar', () => {
    const n = nivelesEfectivos('supervisor', { exportar: 'ver', texto_mensajes: 'ninguno' });
    expect(n.exportar).toBe('ver');
    expect(n.texto_mensajes).toBe('ninguno');
    expect(n.horarios).toBe('editar');
  });

  it('usa la matriz guardada en la base cuando se entrega', () => {
    const n = nivelesEfectivos('dueno', {}, { exportar: 'ninguno' });
    expect(n.exportar).toBe('ninguno');
    expect(n.metas).toBe('editar');
  });

  it('el administrador conserva siempre usuarios y configuración', () => {
    const n = nivelesEfectivos('admin', { usuarios: 'ninguno', configuracion: 'ver' });
    expect(n.usuarios).toBe('editar');
    expect(n.configuracion).toBe('editar');
  });
});

describe('alcanzaNivel', () => {
  it('editar incluye ver', () => {
    expect(alcanzaNivel('editar', 'ver')).toBe(true);
    expect(alcanzaNivel('ver', 'ver')).toBe(true);
    expect(alcanzaNivel('ver', 'editar')).toBe(false);
    expect(alcanzaNivel('ninguno', 'ver')).toBe(false);
  });
});

describe('validarCambioAdmin', () => {
  const base = { rolActual: 'admin', activoActual: true } as const;

  it('impide degradar al último administrador', () => {
    expect(
      validarCambioAdmin({ ...base, rolNuevo: 'dueno', activoNuevo: true, adminsActivos: 1 }),
    ).not.toBeNull();
  });

  it('impide desactivar al último administrador', () => {
    expect(
      validarCambioAdmin({ ...base, rolNuevo: 'admin', activoNuevo: false, adminsActivos: 1 }),
    ).not.toBeNull();
  });

  it('permite degradar si quedan otros administradores', () => {
    expect(
      validarCambioAdmin({ ...base, rolNuevo: 'dueno', activoNuevo: true, adminsActivos: 2 }),
    ).toBeNull();
  });

  it('no afecta a otros roles', () => {
    expect(
      validarCambioAdmin({
        rolActual: 'supervisor',
        activoActual: true,
        rolNuevo: 'asesor',
        activoNuevo: false,
        adminsActivos: 1,
      }),
    ).toBeNull();
  });
});
