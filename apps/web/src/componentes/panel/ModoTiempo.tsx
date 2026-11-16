'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

type Modo = 'laboral' | 'corrido';

const OPCIONES: { modo: Modo; titulo: string; texto: string }[] = [
  {
    modo: 'laboral',
    titulo: 'Horario laboral',
    texto: 'Solo cuenta el tiempo dentro del horario de cada asesor, sin feriados ni ausencias.',
  },
  {
    modo: 'corrido',
    titulo: 'Tiempo corrido (24/7)',
    texto:
      'Cuenta todo el tiempo de reloj, incluidas noches y domingos. Útil si los horarios varían.',
  },
];

/** Cómo se miden los tiempos de la subcuenta. Al cambiarlo, el historial se recalcula en unos minutos. */
export function ModoTiempo({
  locationId,
  modo,
  puedeEditar,
  recalculando,
}: {
  locationId: string;
  modo: Modo;
  puedeEditar: boolean;
  recalculando: boolean;
}) {
  const router = useRouter();
  const [elegido, setElegido] = useState<Modo>(modo);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const guardar = async () => {
    setEnviando(true);
    setMensaje(null);
    const r = await fetch(`/api/subcuentas/${locationId}/modo-tiempo`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modo: elegido }),
    });
    setEnviando(false);
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    if (!r.ok) return setMensaje({ tipo: 'error', texto: d.error ?? 'No se pudo guardar.' });
    setMensaje({
      tipo: 'ok',
      texto: 'Guardado. Los indicadores de días anteriores se recalculan en los próximos minutos.',
    });
    router.refresh();
  };

  return (
    <section aria-label="Cómo se cuenta el tiempo" className="seccion seccion--relleno">
      <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="seccion__titulo seccion__titulo--chico">Cómo se cuenta el tiempo</h2>
          <span className="seccion__nota">
            Aplica a tiempo de respuesta, espera, seguimiento y cierre de toda la subcuenta.
          </span>
        </div>
        {puedeEditar && elegido !== modo && (
          <button
            type="button"
            className="boton"
            onClick={() => void guardar()}
            disabled={enviando}
          >
            {enviando ? 'Guardando…' : 'Guardar'}
          </button>
        )}
      </div>
      {mensaje && (
        <p className={`aviso aviso--${mensaje.tipo}`} role="status">
          {mensaje.texto}
        </p>
      )}
      {!mensaje && recalculando && (
        <p className="aviso aviso--info" role="status">
          Recalculando los indicadores de días anteriores con el modo actual.
        </p>
      )}
      <div
        role="radiogroup"
        aria-label="Modo de tiempo"
        className="rejilla"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(280px, 100%), 1fr))', gap: 8 }}
      >
        {OPCIONES.map((o) => (
          <button
            key={o.modo}
            type="button"
            role="radio"
            aria-checked={elegido === o.modo}
            disabled={!puedeEditar}
            className={`opcion-clara${elegido === o.modo ? ' opcion-clara--on' : ''}`}
            onClick={() => setElegido(o.modo)}
          >
            <span
              className={`punto-radio${elegido === o.modo ? ' punto-radio--on' : ''}`}
              aria-hidden="true"
            />
            <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
              <span style={{ fontWeight: 600 }}>{o.titulo}</span>
              <span style={{ fontSize: 12, color: '#5B6475' }}>{o.texto}</span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
