'use client';

import { enviar } from './enviar';

export function BotonSalir({
  clase = 'boton-secundario',
  texto = 'Cerrar sesión',
}: { clase?: string; texto?: string } = {}) {
  return (
    <button
      type="button"
      className={clase}
      onClick={async () => {
        await enviar('/api/auth/salir', {});
        // Carga completa intencional al cambiar de sesión: no queda nada de la anterior en el navegador.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign('/ingresar');
      }}
    >
      {texto}
    </button>
  );
}
