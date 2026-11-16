import { redirect } from 'next/navigation';
import { requerirModuloPagina } from '@/servidor/pagina';

export default async function Subcuentas() {
  const { ctx } = await requerirModuloPagina('vista_subcuenta');
  redirect(ctx.subcuentas[0] ? `/subcuentas/${ctx.subcuentas[0]}` : '/sin-subcuentas');
}
