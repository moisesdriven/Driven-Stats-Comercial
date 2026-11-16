import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/esquema/index.ts',
  out: './migraciones',
  // Drizzle gestiona solo el esquema propio. Nunca "ghl" ni "app" de Driven Conteo.
  schemaFilter: ['comercial'],
  migrations: { schema: 'comercial', table: '__migraciones' },
  dbCredentials: { url: process.env.DATABASE_URL_MIGRADOR ?? '' },
});
