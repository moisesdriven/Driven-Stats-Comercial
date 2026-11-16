import { redirect } from 'next/navigation';
import { TarjetaAuth } from '@/componentes/TarjetaAuth';
import { obtenerSesionPagina } from '@/servidor/pagina';
import { FormularioIngreso } from './FormularioIngreso';

export const metadata = { title: 'Ingresar · Driven Comercial' };

export default async function PaginaIngresar() {
  const estado = await obtenerSesionPagina();
  if (estado && (!estado.ctx.totpActivo || estado.sesion.verificada2fa)) redirect('/');
  return (
    <TarjetaAuth
      titulo="Ingresar"
      subtitulo="Usa el correo y la contraseña que te dio el administrador."
    >
      <FormularioIngreso />
    </TarjetaAuth>
  );
}
