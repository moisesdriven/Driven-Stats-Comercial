/** Recorrido por rol: lo que cada uno ve en el menú y que una URL sin permiso responde 403. */
import { expect, test, type Page } from '@playwright/test';
import { CLAVE_PRUEBA } from '../src/pruebas/entorno';

async function ingresar(page: Page, correo: string) {
  await page.goto('/ingresar');
  await page.getByLabel('Correo').fill(correo);
  await page.getByLabel('Contraseña').fill(CLAVE_PRUEBA);
  await page.getByRole('button', { name: /ingresar/i }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/ingresar'));
}

test('sin sesión, el panel redirige al login', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/ingresar/);
});

test('el administrador ve la vista general y la administración', async ({ page }) => {
  await ingresar(page, 'admin@e2e.pe');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Vista general');
  const menu = page.getByRole('navigation', { name: 'Navegación principal' });
  await expect(menu.getByRole('link', { name: 'Usuarios y accesos' })).toBeVisible();
  await expect(page.getByRole('table').first()).toContainText('Tienda Sur');
  await menu.getByRole('link', { name: 'Usuarios y accesos' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Usuarios y accesos');
  await expect(
    page.getByRole('region', { name: 'Lista de usuarios' }).getByRole('table'),
  ).toContainText('dueno@e2e.pe');
});

test('el dueño solo ve su subcuenta y una URL ajena responde 403', async ({ page }) => {
  await ingresar(page, 'dueno@e2e.pe');
  await expect(page.getByRole('table').first()).toContainText('Tienda Norte');
  await expect(page.getByRole('table').first()).not.toContainText('Tienda Sur');
  await expect(page.getByRole('link', { name: 'Usuarios y accesos' })).toHaveCount(0);

  for (const ruta of ['/subcuentas/LOC_B', '/usuarios', '/configuracion']) {
    const r = await page.goto(ruta);
    expect(r?.status(), ruta).toBe(403);
  }
  const r = await page.goto('/subcuentas/LOC_A');
  expect(r?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tienda Norte');
});

test('el asesor entra a su propio detalle y no ve el de otro', async ({ page }) => {
  await ingresar(page, 'asesor@e2e.pe');
  await expect(page).toHaveURL(/\/subcuentas\/LOC_A\/asesores\/U1/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Rosa Quispe');
  const r = await page.goto('/subcuentas/LOC_A/asesores/U2');
  expect(r?.status()).toBe(403);
  expect((await page.goto('/'))?.url()).toContain('/asesores/U1');
});
