import { headers } from 'next/headers';
import type { ReactNode } from 'react';
import { Menu } from '@/componentes/panel/Menu';
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
  return (
    <div className="panel">
      <Menu ctx={ctx} subcuentas={subcuentas} />
      <main className="contenido">{children}</main>
    </div>
  );
}
