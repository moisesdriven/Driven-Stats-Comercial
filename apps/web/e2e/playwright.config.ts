/**
 * Prueba de punta a punta (§12): login y permisos en el navegador contra el build de producción y una
 * base desechable (DATABASE_URL_TEST). Requiere `pnpm build` antes. Nunca usa tokens reales.
 */
import { randomBytes } from 'node:crypto';
import { defineConfig } from '@playwright/test';

const PUERTO = 3199;
const base = process.env.DATABASE_URL_TEST ?? '';

export default defineConfig({
  testDir: '.',
  globalSetup: './preparar.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PUERTO}`,
    trace: 'off',
    locale: 'es-PE',
    timezoneId: 'America/Lima',
  },
  webServer: {
    // Servidor standalone del build (como en Docker): necesita los estáticos junto a server.js.
    command:
      'rm -rf .next/standalone/apps/web/.next/static && cp -r .next/static .next/standalone/apps/web/.next/static && node .next/standalone/apps/web/server.js',
    cwd: '..',
    url: `http://localhost:${PUERTO}/api/salud`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      PORT: String(PUERTO),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: base,
      CLAVE_CIFRADO: randomBytes(32).toString('base64'),
      NEXT_TELEMETRY_DISABLED: '1',
    },
  },
});
