import { redirect } from 'next/navigation';
import { TarjetaAuth } from '@/componentes/TarjetaAuth';
import { obtenerSesionPagina } from '@/servidor/pagina';
import { FormularioCodigo } from './FormularioCodigo';

export const metadata = { title: 'Verificación · Driven Comercial' };

export default async function PaginaVerificar() {
  const estado = await obtenerSesionPagina();
  if (!estado) redirect('/ingresar');
  if (!estado.ctx.totpActivo || estado.sesion.verificada2fa) redirect('/');
  return (
    <TarjetaAuth
      titulo="Verificación en dos pasos"
      subtitulo="Ingresa el código que muestra tu aplicación de autenticación."
    >
      <FormularioCodigo />
    </TarjetaAuth>
  );
}
