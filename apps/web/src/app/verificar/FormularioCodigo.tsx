'use client';

import { useState, type FormEvent } from 'react';
import { enviar } from '@/componentes/enviar';

export function FormularioCodigo() {
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const r = await enviar('/api/auth/2fa/verificar', {
      codigo: new FormData(e.currentTarget).get('codigo'),
    });
    setEnviando(false);
    if (!r.ok) {
      setError(String(r.datos.error ?? 'Código incorrecto.'));
      return;
    }
    window.location.assign(r.datos.debeCambiarClave ? '/cambiar-clave' : '/');
  }

  return (
    <form method="post" onSubmit={alEnviar} className="formulario" noValidate>
      <label className="campo">
        <span>Código de 6 dígitos</span>
        <input
          name="codigo"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
        />
      </label>
      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="boton-primario" disabled={enviando}>
        {enviando ? 'Verificando…' : 'Verificar'}
      </button>
    </form>
  );
}
