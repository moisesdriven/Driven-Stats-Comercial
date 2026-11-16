import { z } from 'zod';

/** Variables de entorno del worker (validadas al arrancar). */
const esquema = z.object({
  DATABASE_URL_WORKER: z.string().min(1, 'Falta DATABASE_URL_WORKER.'),
  CLAVE_CIFRADO: z.string().min(1, 'Falta CLAVE_CIFRADO.'),
  MODO_ALERTAS: z.enum(['sombra', 'activo']).default('sombra'),
  SYNC_INCREMENTAL_MINUTOS: z.coerce.number().int().min(5).max(60).default(15),
  SYNC_NOCTURNO_HORA: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .default('02:30'),
  ZONA_HORARIA_DEFECTO: z.string().default('America/Lima'),
  GHL_MAX_LLAMADAS_10S: z.coerce.number().int().min(10).max(100).default(80),
});

export type Configuracion = z.infer<typeof esquema>;

export function leerConfiguracion(env: NodeJS.ProcessEnv = process.env): Configuracion {
  const r = esquema.safeParse(env);
  if (!r.success) throw new Error(r.error.issues.map((i) => i.message).join(' '));
  return r.data;
}
