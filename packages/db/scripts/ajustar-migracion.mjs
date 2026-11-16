/**
 * Ajustes manuales que drizzle-kit no sabe generar, aplicados a una migración recién generada:
 *  1. Quita `CREATE SCHEMA` (el esquema lo crea scripts/sql/esquema_y_roles.sql; el rol migrador no
 *     tiene permiso para crear esquemas).
 *  2. Particiona `mensajes` por mes y agrega la función que crea las particiones.
 * Uso: node scripts/ajustar-migracion.mjs migraciones/0000_inicial.sql
 * Solo para la migración que crea `mensajes`; las siguientes no lo necesitan.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const archivo = process.argv[2];
let s = readFileSync(archivo, 'utf8');
s = s.replace(
  'CREATE SCHEMA "comercial";',
  '-- El esquema "comercial" lo crea scripts/sql/esquema_y_roles.sql (dueño: comercial_migrador).\n-- El rol migrador no tiene permiso para crear esquemas en la base compartida, a propósito.\nSELECT 1;',
);
const pk = '\tCONSTRAINT "mensajes_message_id_fecha_pk" PRIMARY KEY("message_id","fecha")\n);';
if (!s.includes(pk)) throw new Error('No se encontró la tabla mensajes en la migración.');
s = s.replace(pk, pk.slice(0, -2) + ') PARTITION BY RANGE ("fecha");');
const particiones = readFileSync(new URL('./particiones-mensajes.sql', import.meta.url), 'utf8');
s = s.trimEnd() + '\n--> statement-breakpoint\n' + particiones;
writeFileSync(archivo, s);
console.log(`Migración ajustada: ${archivo}`);
