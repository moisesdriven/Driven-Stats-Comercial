'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { enviar } from '@/componentes/enviar';

export function FormularioIngreso() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function alEnviar(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    const f = new FormData(e.currentTarget);
    const r = await enviar('/api/auth/ingresar', {
      correo: f.get('correo'),
      clave: f.get('clave'),
    });
    setEnviando(false);
    if (!r.ok) {
      setError(String(r.datos.error ?? 'No se pudo iniciar sesión.'));
      return;
    }
    router.replace(
      r.datos.requiere2fa ? '/verificar' : r.datos.debeCambiarClave ? '/cambiar-clave' : '/',
    );
    router.refresh();
  }

  return (
    <form onSubmit={alEnviar} className="formulario" noValidate>
      <label className="campo">
        <span>Correo</span>
        <input name="correo" type="email" autoComplete="username" required autoFocus />
      </label>
      <label className="campo">
        <span>Contraseña</span>
        <input name="clave" type="password" autoComplete="current-password" required />
      </label>
      {error && (
        <p className="mensaje-error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="boton-primario" disabled={enviando}>
        {enviando ? 'Ingresando…' : 'Ingresar'}
      </button>
    </form>
  );
}
