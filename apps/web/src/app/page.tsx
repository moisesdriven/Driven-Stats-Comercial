import { MODULOS, NOMBRES_MODULO, NOMBRES_ROL } from '@driven/core';
import { BotonSalir } from '@/componentes/BotonSalir';
import { requerirSesionPagina } from '@/servidor/pagina';

export const dynamic = 'force-dynamic';

/** Página provisional: las vistas reales (general, subcuenta, asesor…) llegan en la fase 5. */
export default async function Inicio() {
  const { ctx } = await requerirSesionPagina();
  const modulos = MODULOS.filter((m) => ctx.modulos[m] !== 'ninguno');
  return (
    <main className="inicio">
      <header className="inicio__cabecera">
        <div>
          <h1>Hola, {ctx.nombre}</h1>
          <p>
            {NOMBRES_ROL[ctx.rol]} ·{' '}
            {ctx.rol === 'admin'
              ? 'todas las subcuentas'
              : `${ctx.subcuentas.length} subcuenta(s) asignada(s)`}
          </p>
        </div>
        <BotonSalir />
      </header>
      <section className="inicio__tarjeta">
        <h2>Módulos con acceso</h2>
        <ul>
          {modulos.map((m) => (
            <li key={m}>
              {NOMBRES_MODULO[m]} ·{' '}
              <strong>{ctx.modulos[m] === 'editar' ? 'editar' : 'ver'}</strong>
            </li>
          ))}
        </ul>
        <p className="inicio__nota">Las vistas de indicadores se habilitan en la fase 5.</p>
      </section>
    </main>
  );
}
