'use client';

import { useRouter } from 'next/navigation';
import { enviar } from './enviar';

export function BotonSalir({
  clase = 'boton-secundario',
  texto = 'Cerrar sesión',
}: { clase?: string; texto?: string } = {}) {
  const router = useRouter();
  return (
    <button
      type="button"
      className={clase}
      onClick={async () => {
        await enviar('/api/auth/salir', {});
        router.replace('/ingresar');
        router.refresh();
      }}
    >
      {texto}
    </button>
  );
}
