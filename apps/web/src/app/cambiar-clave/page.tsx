import { redirect } from 'next/navigation';
import { TarjetaAuth } from '@/componentes/TarjetaAuth';
import { obtenerSesionPagina } from '@/servidor/pagina';
import { FormularioCambio } from './FormularioCambio';

export const metadata = { title: 'Cambiar contraseña · Driven Comercial' };

export default async function PaginaCambiarClave() {
  const estado = await obtenerSesionPagina();
  if (!estado) redirect('/ingresar');
  if (estado.ctx.totpActivo && !estado.sesion.verificada2fa) redirect('/verificar');
  return (
    <TarjetaAuth
      titulo="Cambia tu contraseña"
      subtitulo={
        estado.ctx.debeCambiarClave
          ? 'Por seguridad, reemplaza la contraseña temporal antes de continuar.'
          : 'Elige una contraseña nueva.'
      }
    >
      <FormularioCambio />
    </TarjetaAuth>
  );
}
