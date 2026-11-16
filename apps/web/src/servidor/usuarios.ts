/** Administración de usuarios y accesos (§10.1, pantalla "Usuarios y accesos"). Solo admin. */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { MODULOS, NIVELES, ROLES, validarCambioAdmin, type Rol } from '@driven/core';
import { tablas, type Db } from '@driven/db';
import { exigirAdmin, type ContextoAcceso } from './acceso';
import { auditar } from './auditoria';
import { generarClaveTemporal, hashearClave } from './claves';
import { normalizarCorreo } from './autenticacion';
import { ErrorHttp, noEncontrado, solicitudInvalida } from './errores';
import { eliminarSesionesDeUsuario } from './sesiones';

const excepcionesEsquema = z.partialRecord(z.enum(MODULOS), z.enum(NIVELES));

export const esquemaNuevoUsuario = z.object({
  correo: z.email('Correo inválido.'),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.').max(120),
  rol: z.enum(ROLES),
  subcuentas: z.array(z.string().min(1)).default([]),
  excepciones: excepcionesEsquema.default({}),
  userIdGhl: z.string().min(1).nullable().default(null),
});

export const esquemaCambiosUsuario = z.object({
  nombre: z.string().trim().min(1).max(120).optional(),
  rol: z.enum(ROLES).optional(),
  activo: z.boolean().optional(),
  subcuentas: z.array(z.string().min(1)).optional(),
  excepciones: excepcionesEsquema.optional(),
  userIdGhl: z.string().min(1).nullable().optional(),
});

export interface UsuarioListado {
  id: string;
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  subcuentas: string[];
  excepciones: Record<string, string>;
  userIdGhl: string | null;
  totpActivo: boolean;
  ultimoIngreso: Date | null;
}

export async function listarUsuarios(db: Db, ctx: ContextoAcceso): Promise<UsuarioListado[]> {
  exigirAdmin(ctx);
  const [us, subs, exc, vinc] = await Promise.all([
    db.select().from(tablas.usuarios).orderBy(tablas.usuarios.nombre),
    db.select().from(tablas.usuarioSubcuenta),
    db.select().from(tablas.permisosUsuario),
    db.select().from(tablas.usuarioAsesor),
  ]);
  return us.map((u) => ({
    id: u.id,
    correo: u.correo,
    nombre: u.nombre,
    rol: u.rol,
    activo: u.activo,
    subcuentas: subs.filter((s) => s.usuarioId === u.id).map((s) => s.locationId),
    excepciones: Object.fromEntries(
      exc.filter((e) => e.usuarioId === u.id).map((e) => [e.modulo, e.nivel]),
    ),
    userIdGhl: vinc.find((v) => v.usuarioId === u.id)?.userId ?? null,
    totpActivo: u.totpSecretoCifrado !== null,
    ultimoIngreso: u.ultimoIngreso,
  }));
}

async function validarSubcuentas(db: Db, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const existentes = await db
    .select({ id: tablas.subcuentas.locationId })
    .from(tablas.subcuentas)
    .where(inArray(tablas.subcuentas.locationId, ids));
  const faltan = ids.filter((id) => !existentes.some((e) => e.id === id));
  if (faltan.length) throw solicitudInvalida(`Subcuentas inexistentes: ${faltan.join(', ')}.`);
}

function validarVinculoAsesor(rol: Rol, userIdGhl: string | null): void {
  if (rol === 'asesor' && !userIdGhl) {
    throw solicitudInvalida('Un asesor debe estar vinculado a su usuario de GHL.');
  }
}

async function guardarAccesos(
  db: Db,
  usuarioId: string,
  datos: {
    subcuentas?: string[] | undefined;
    excepciones?: Record<string, string> | undefined;
    userIdGhl?: string | null | undefined;
  },
): Promise<void> {
  if (datos.subcuentas) {
    await db
      .delete(tablas.usuarioSubcuenta)
      .where(eq(tablas.usuarioSubcuenta.usuarioId, usuarioId));
    const unicas = [...new Set(datos.subcuentas)];
    if (unicas.length) {
      await db
        .insert(tablas.usuarioSubcuenta)
        .values(unicas.map((locationId) => ({ usuarioId, locationId })));
    }
  }
  if (datos.excepciones) {
    await db.delete(tablas.permisosUsuario).where(eq(tablas.permisosUsuario.usuarioId, usuarioId));
    const filas = Object.entries(datos.excepciones).map(([modulo, nivel]) => ({
      usuarioId,
      modulo,
      nivel: nivel as (typeof NIVELES)[number],
    }));
    if (filas.length) await db.insert(tablas.permisosUsuario).values(filas);
  }
  if (datos.userIdGhl !== undefined) {
    await db.delete(tablas.usuarioAsesor).where(eq(tablas.usuarioAsesor.usuarioId, usuarioId));
    if (datos.userIdGhl)
      await db.insert(tablas.usuarioAsesor).values({ usuarioId, userId: datos.userIdGhl });
  }
}

export async function crearUsuario(
  db: Db,
  ctx: ContextoAcceso,
  entrada: z.infer<typeof esquemaNuevoUsuario>,
): Promise<{ id: string; claveTemporal: string }> {
  exigirAdmin(ctx);
  const correo = normalizarCorreo(entrada.correo);
  validarVinculoAsesor(entrada.rol, entrada.userIdGhl);
  await validarSubcuentas(db, entrada.subcuentas);
  const claveTemporal = generarClaveTemporal();
  const hash = await hashearClave(claveTemporal);

  const id = await db.transaction(async (tx) => {
    const existe = await tx
      .select({ id: tablas.usuarios.id })
      .from(tablas.usuarios)
      .where(eq(tablas.usuarios.correo, correo));
    if (existe.length)
      throw new ErrorHttp(409, 'Ya existe un usuario con ese correo.', 'correo_duplicado');
    const [u] = await tx
      .insert(tablas.usuarios)
      .values({ correo, nombre: entrada.nombre, rol: entrada.rol, hash, debeCambiarClave: true })
      .returning({ id: tablas.usuarios.id });
    await guardarAccesos(tx as unknown as Db, u!.id, entrada);
    return u!.id;
  });

  await auditar(db, ctx.usuarioId, 'usuario_creado', {
    usuario: id,
    correo,
    rol: entrada.rol,
    subcuentas: entrada.subcuentas,
    excepciones: entrada.excepciones,
    userIdGhl: entrada.userIdGhl,
  });
  return { id, claveTemporal };
}

export async function actualizarUsuario(
  db: Db,
  ctx: ContextoAcceso,
  usuarioId: string,
  cambios: z.infer<typeof esquemaCambiosUsuario>,
): Promise<void> {
  exigirAdmin(ctx);
  const [actual] = await db
    .select()
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.id, usuarioId))
    .limit(1);
  if (!actual) throw noEncontrado('Usuario no encontrado.');
  const [antes] = (await listarUsuarios(db, ctx)).filter((u) => u.id === usuarioId);

  const rolNuevo = cambios.rol ?? actual.rol;
  const activoNuevo = cambios.activo ?? actual.activo;
  const [{ admins } = { admins: 0 }] = await db
    .select({ admins: sql<number>`count(*)::int` })
    .from(tablas.usuarios)
    .where(and(eq(tablas.usuarios.rol, 'admin'), eq(tablas.usuarios.activo, true)));
  const error = validarCambioAdmin({
    rolActual: actual.rol,
    activoActual: actual.activo,
    rolNuevo,
    activoNuevo,
    adminsActivos: admins,
  });
  if (error) throw new ErrorHttp(409, error, 'ultimo_admin');

  const userIdGhl =
    cambios.userIdGhl !== undefined ? cambios.userIdGhl : (antes?.userIdGhl ?? null);
  validarVinculoAsesor(rolNuevo, userIdGhl);
  if (cambios.subcuentas) await validarSubcuentas(db, cambios.subcuentas);

  await db.transaction(async (tx) => {
    const campos: Partial<typeof tablas.usuarios.$inferInsert> = {};
    if (cambios.nombre !== undefined) campos.nombre = cambios.nombre;
    if (cambios.rol !== undefined) campos.rol = cambios.rol;
    if (cambios.activo !== undefined) campos.activo = cambios.activo;
    if (Object.keys(campos).length) {
      await tx.update(tablas.usuarios).set(campos).where(eq(tablas.usuarios.id, usuarioId));
    }
    await guardarAccesos(tx as unknown as Db, usuarioId, cambios);
  });

  if (cambios.activo === false) await eliminarSesionesDeUsuario(db, usuarioId);

  const [despues] = (await listarUsuarios(db, ctx)).filter((u) => u.id === usuarioId);
  const diferencias: Record<string, { antes: unknown; despues: unknown }> = {};
  for (const k of ['nombre', 'rol', 'activo', 'subcuentas', 'excepciones', 'userIdGhl'] as const) {
    if (JSON.stringify(antes?.[k]) !== JSON.stringify(despues?.[k])) {
      diferencias[k] = { antes: antes?.[k], despues: despues?.[k] };
    }
  }
  if (Object.keys(diferencias).length) {
    await auditar(db, ctx.usuarioId, 'usuario_actualizado', {
      usuario: usuarioId,
      cambios: diferencias,
    });
  }
}

export async function restablecerClave(
  db: Db,
  ctx: ContextoAcceso,
  usuarioId: string,
): Promise<{ claveTemporal: string }> {
  exigirAdmin(ctx);
  const claveTemporal = generarClaveTemporal();
  const r = await db
    .update(tablas.usuarios)
    .set({ hash: await hashearClave(claveTemporal), debeCambiarClave: true })
    .where(eq(tablas.usuarios.id, usuarioId))
    .returning({ id: tablas.usuarios.id });
  if (!r.length) throw noEncontrado('Usuario no encontrado.');
  await eliminarSesionesDeUsuario(db, usuarioId);
  await auditar(db, ctx.usuarioId, 'clave_restablecida', { usuario: usuarioId });
  return { claveTemporal };
}
