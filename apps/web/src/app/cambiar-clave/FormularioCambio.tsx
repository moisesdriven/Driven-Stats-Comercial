'use client';

import { useState, type FormEvent } from 'react';
import { enviar } from '@/componentes/enviar';

export function FormularioCambio() {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get('claveNueva') !== f.get('confirmacion')) {
      setError('La confirmación no coincide con la nueva contraseña.');
      return;
    }
    setError(null);
    setEnviando(true);
    const r = await enviar('/api/auth/cambiar-clave', {
      claveActual: f.get('claveActual'),
      claveNueva: f.get('claveNueva'),
    });
    setEnviando(false);
    if (!r.ok) {
      setError(String(r.datos.error ?? 'No se pudo cambiar la contraseña.'));
      return;
    }
    // Carga completa intencional al cambiar de sesión: no queda nada de la anterior en el navegador.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign('/');
  }

  return (
    <form method="post" onSubmit={alEnviar} className="formulario" noValidate>
      <label className="campo">
        <span>Contraseña actual (o temporal)</span>
        <input name="claveActual" type="password" autoComplete="current-password" required />
      </label>
      <label className="campo">
        <span>Nueva contraseña</span>
        <input
          name="claveNueva"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
        />
        <small>Mínimo 10 caracteres, con letras y números.</small>
      </label>
      <label className="campo">
        <span>Repite la nueva contraseña</span>
        <input name="confirmacion" type="password" autoComplete="new-password" required />
      </label>
      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="boton-primario" disabled={enviando}>
        {enviando ? 'Guardando…' : 'Guardar contraseña'}
      </button>
    </form>
  );
}
