import { cookies, headers } from 'next/headers';
import type { ReactNode } from 'react';
import { MarcoPanel } from '@/componentes/panel/MarcoPanel';
import { Menu } from '@/componentes/panel/Menu';
import { COOKIE_MENU, MENU_CONTRAIDO } from '@/lib/preferencias';
import { subcuentasMenu } from '@/servidor/consultas/menu';
import { obtenerDb } from '@/servidor/db';
import { exigirAccesoRuta, requerirSesionPagina } from '@/servidor/pagina';
import './panel.css';

export const dynamic = 'force-dynamic';

/** Panel con menú lateral. Los permisos se validan en cada página y cada endpoint (§10.1). */
export default async function LayoutPanel({ children }: { children: ReactNode }) {
  const { ctx } = await requerirSesionPagina();
  // Acceso a la ruta pedida antes del primer byte: así una URL sin permiso responde 403 aunque la
  // página se envíe por streaming. En la navegación interna lo revisa cada página.
  const ruta = (await headers()).get('x-ruta');
  if (ruta) exigirAccesoRuta(ctx, ruta);
  const subcuentas = await subcuentasMenu(obtenerDb(), ctx);
  const contraido = (await cookies()).get(COOKIE_MENU)?.value === MENU_CONTRAIDO;
  return (
    <MarcoPanel contraidoInicial={contraido} menu={<Menu ctx={ctx} subcuentas={subcuentas} />}>
      {children}
    </MarcoPanel>
  );
}
