import type { ReactNode } from 'react';
import { IconoTendencia } from './panel/Iconos';

export function TarjetaAuth({
  titulo,
  subtitulo,
  children,
}: {
  titulo: string;
  subtitulo: string;
  children: ReactNode;
}) {
  return (
    <main className="auth">
      <section className="auth__tarjeta" aria-labelledby="auth-titulo">
        <div className="auth__marca">
          <span className="auth__logo" aria-hidden="true">
            <IconoTendencia />
          </span>
          <div>
            <strong>Driven Comercial</strong>
            <span>Medición de equipos</span>
          </div>
        </div>
        <h1 id="auth-titulo">{titulo}</h1>
        <p className="auth__subtitulo">{subtitulo}</p>
        {children}
      </section>
    </main>
  );
}
