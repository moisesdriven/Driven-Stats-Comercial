import type { ReactNode } from 'react';
import { Menu } from '@/componentes/panel/Menu';
import { subcuentasMenu } from '@/servidor/consultas/menu';
import { obtenerDb } from '@/servidor/db';
import { requerirSesionPagina } from '@/servidor/pagina';
import './panel.css';

export const dynamic = 'force-dynamic';

/** Panel con menú lateral. Los permisos se validan en cada página y cada endpoint (§10.1). */
export default async function LayoutPanel({ children }: { children: ReactNode }) {
  const { ctx } = await requerirSesionPagina();
  const subcuentas = await subcuentasMenu(obtenerDb(), ctx);
  return (
    <div className="panel">
      <Menu ctx={ctx} subcuentas={subcuentas} />
      <main className="contenido">{children}</main>
    </div>
  );
}
