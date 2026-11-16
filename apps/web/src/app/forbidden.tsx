import Link from 'next/link';

/** 403: la URL corresponde a un módulo o subcuenta sin permiso (§10.1). */
export default function Prohibido() {
  return (
    <main className="auth">
      <section className="auth__tarjeta">
        <h1>No tienes acceso</h1>
        <p className="auth__subtitulo">
          Tu usuario no tiene permiso para ver esta página. Si crees que es un error, pide acceso al
          administrador.
        </p>
        <Link
          href="/"
          className="boton-primario"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            textDecoration: 'none',
          }}
        >
          Ir al inicio
        </Link>
      </section>
    </main>
  );
}
