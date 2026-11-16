import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { tablas, type Db } from '@driven/db';
import { auditar } from './auditoria';
import { normalizarCorreo } from './autenticacion';
import { generarClaveTemporal, hashearClave } from './claves';

const esquema = z.object({
  correo: z.email('Correo inválido.'),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio.'),
});

/**
 * Crea un administrador con contraseña temporal (debe cambiarla al primer ingreso).
 * La contraseña se devuelve para mostrarla una sola vez; nunca se guarda en claro ni en la auditoría.
 */
export async function crearAdministrador(
  db: Db,
  datos: { correo: string; nombre: string },
): Promise<{ id: string; claveTemporal: string }> {
  const { correo: c, nombre } = esquema.parse(datos);
  const correo = normalizarCorreo(c);
  const existe = await db
    .select({ id: tablas.usuarios.id })
    .from(tablas.usuarios)
    .where(eq(tablas.usuarios.correo, correo));
  if (existe.length) throw new Error(`Ya existe un usuario con el correo ${correo}.`);
  const claveTemporal = generarClaveTemporal();
  const [u] = await db
    .insert(tablas.usuarios)
    .values({
      correo,
      nombre,
      rol: 'admin',
      hash: await hashearClave(claveTemporal),
      debeCambiarClave: true,
    })
    .returning({ id: tablas.usuarios.id });
  await auditar(db, null, 'admin_creado', { usuario: u!.id, correo, origen: 'crear-admin' });
  return { id: u!.id, claveTemporal };
}
