/**
 * Roles, módulos y niveles de acceso (ESPECIFICACION.md §10.1).
 * Reglas puras: la carga desde la base y el filtro por subcuenta viven en la capa de acceso a datos.
 */

export const ROLES = ['admin', 'dueno', 'supervisor', 'asesor'] as const;
export type Rol = (typeof ROLES)[number];

export const NOMBRES_ROL: Record<Rol, string> = {
  admin: 'Administrador',
  dueno: 'Dueño de negocio',
  supervisor: 'Supervisor',
  asesor: 'Asesor',
};

export const MODULOS = [
  'vista_general',
  'vista_subcuenta',
  'detalle_asesores',
  'texto_mensajes',
  'horarios',
  'metas',
  'exportar',
  'configuracion',
  'usuarios',
] as const;
export type Modulo = (typeof MODULOS)[number];

export const NOMBRES_MODULO: Record<Modulo, string> = {
  vista_general: 'Vista general (de sus subcuentas)',
  vista_subcuenta: 'Vista por subcuenta',
  detalle_asesores: 'Detalle de asesores',
  texto_mensajes: 'Texto de mensajes',
  horarios: 'Horarios y ausencias',
  metas: 'Metas, umbrales y etapas de calidad',
  exportar: 'Exportar',
  configuracion: 'Subcuentas, tokens y mapa de etapas',
  usuarios: 'Usuarios y accesos',
};

export const NIVELES = ['ninguno', 'ver', 'editar'] as const;
export type Nivel = (typeof NIVELES)[number];

/** Matriz de módulos por defecto de la §10.1 (se siembra en `permisos_rol`). */
export const MATRIZ_POR_DEFECTO: Record<Rol, Record<Modulo, Nivel>> = {
  admin: {
    vista_general: 'editar',
    vista_subcuenta: 'editar',
    detalle_asesores: 'editar',
    texto_mensajes: 'ver',
    horarios: 'editar',
    metas: 'editar',
    exportar: 'ver',
    configuracion: 'editar',
    usuarios: 'editar',
  },
  dueno: {
    vista_general: 'ver',
    vista_subcuenta: 'ver',
    detalle_asesores: 'ver',
    texto_mensajes: 'ver',
    horarios: 'ver',
    metas: 'editar',
    exportar: 'ver',
    configuracion: 'ninguno',
    usuarios: 'ninguno',
  },
  supervisor: {
    vista_general: 'ninguno',
    vista_subcuenta: 'ver',
    detalle_asesores: 'ver',
    texto_mensajes: 'ver',
    horarios: 'editar',
    metas: 'ver',
    exportar: 'ninguno',
    configuracion: 'ninguno',
    usuarios: 'ninguno',
  },
  // El asesor ve solo lo propio: esa restricción la aplica la capa de datos con su userId de GHL.
  asesor: {
    vista_general: 'ninguno',
    vista_subcuenta: 'ninguno',
    detalle_asesores: 'ver',
    texto_mensajes: 'ver',
    horarios: 'ver',
    metas: 'ninguno',
    exportar: 'ninguno',
    configuracion: 'ninguno',
    usuarios: 'ninguno',
  },
};

/**
 * Módulos que el administrador conserva siempre: si una excepción se los quitara podría quedarse
 * sin acceso a la administración del sistema.
 */
const MODULOS_FIJOS_ADMIN: readonly Modulo[] = ['usuarios', 'configuracion'];

/**
 * Calcula el nivel efectivo de cada módulo: la excepción por usuario reemplaza al valor del rol.
 * `porRol` permite usar la matriz guardada en la base; si falta un módulo se usa la por defecto.
 */
export function nivelesEfectivos(
  rol: Rol,
  excepciones: Partial<Record<Modulo, Nivel>> = {},
  porRol: Partial<Record<Modulo, Nivel>> = MATRIZ_POR_DEFECTO[rol],
): Record<Modulo, Nivel> {
  const resultado = {} as Record<Modulo, Nivel>;
  for (const m of MODULOS) {
    resultado[m] = excepciones[m] ?? porRol[m] ?? MATRIZ_POR_DEFECTO[rol][m];
  }
  if (rol === 'admin') for (const m of MODULOS_FIJOS_ADMIN) resultado[m] = 'editar';
  return resultado;
}

/** ¿El nivel concedido alcanza el requerido? (`editar` incluye `ver`). */
export function alcanzaNivel(concedido: Nivel, requerido: Exclude<Nivel, 'ninguno'>): boolean {
  return NIVELES.indexOf(concedido) >= NIVELES.indexOf(requerido);
}

/**
 * Valida que un cambio de rol o de estado no deje el sistema sin administradores activos.
 * Devuelve un mensaje de error o `null` si el cambio es válido.
 */
export function validarCambioAdmin(params: {
  rolActual: Rol;
  activoActual: boolean;
  rolNuevo: Rol;
  activoNuevo: boolean;
  adminsActivos: number;
}): string | null {
  const eraAdminActivo = params.rolActual === 'admin' && params.activoActual;
  const seraAdminActivo = params.rolNuevo === 'admin' && params.activoNuevo;
  if (eraAdminActivo && !seraAdminActivo && params.adminsActivos <= 1) {
    return 'No se puede quitar el rol ni desactivar al último administrador.';
  }
  return null;
}
