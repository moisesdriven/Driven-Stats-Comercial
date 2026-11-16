'use client';

import { useRouter } from 'next/navigation';
import { enviar } from './enviar';

export function BotonSalir() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="boton-secundario"
      onClick={async () => {
        await enviar('/api/auth/salir', {});
        router.replace('/ingresar');
        router.refresh();
      }}
    >
      Cerrar sesión
    </button>
  );
}
