import { ETAPAS_PROCESO } from '@driven/core';
import { colores, tipografia } from '@driven/ui';

const NOMBRES: Record<(typeof ETAPAS_PROCESO)[number], string> = {
  atencion: 'Atención',
  seguimiento: 'Seguimiento',
  negociacion: 'Negociación',
  cierre: 'Cierre',
};

export default function Inicio() {
  return (
    <main style={{ padding: 32, maxWidth: 960, margin: '0 auto' }}>
      <h1 style={{ fontFamily: tipografia.titulos, fontWeight: 700 }}>Driven Comercial</h1>
      <p style={{ color: colores.textoSecundario }}>
        Sistema en construcción. Las vistas llegan en la fase 5.
      </p>
      <ul>
        {ETAPAS_PROCESO.map((e) => (
          <li key={e}>{NOMBRES[e]}</li>
        ))}
      </ul>
    </main>
  );
}
