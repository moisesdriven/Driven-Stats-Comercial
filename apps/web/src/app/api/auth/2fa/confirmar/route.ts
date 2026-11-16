import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { cifrar, tablas } from '@driven/db';
import { auditar } from '@/servidor/auditoria';
import { obtenerDb } from '@/servidor/db';
import { ErrorHttp } from '@/servidor/errores';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';
import { marcarSesion2fa } from '@/servidor/sesiones';
import { verificarCodigoTotp } from '@/servidor/totp';

const esquema = z.object({
  secreto: z.string().regex(/^[A-Z2-7]{16,64}$/, 'Secreto inválido.'),
  codigo: z.string().min(6).max(10),
});

/** Activa la verificación en dos pasos si el código coincide con el secreto generado. */
export const POST = manejar(async (req) => {
  const { ctx, sesion } = await requerirSesion(req);
  const { secreto, codigo } = await leerJson(req, esquema);
  if (!verificarCodigoTotp(secreto, codigo)) {
    throw new ErrorHttp(400, 'El código no coincide. Revisa la hora de tu teléfono.', 'codigo_2fa');
  }
  const db = obtenerDb();
  await db
    .update(tablas.usuarios)
    .set({ totpSecretoCifrado: cifrar(secreto) })
    .where(eq(tablas.usuarios.id, ctx.usuarioId));
  await marcarSesion2fa(db, sesion.id);
  await auditar(db, ctx.usuarioId, '2fa_activado', {});
  return json({ ok: true });
});
