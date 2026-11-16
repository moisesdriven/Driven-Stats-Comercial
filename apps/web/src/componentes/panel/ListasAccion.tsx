'use client';

import { useState } from 'react';
import { nombreCorto } from '@/lib/formato';
import type { FilaAccion } from '@/servidor/consultas/listas';
import { IconoExterno } from './Iconos';

const CANAL: Record<string, string> = {
  whatsapp: 'WA',
  instagram: 'IG',
  facebook: 'FB',
  sms: 'SMS',
  webchat: 'WEB',
  email: 'MAIL',
  llamada: 'TEL',
};

/** "Para actuar ahora": pestañas con las tres listas y enlace a la conversación en GHL. */
export function ListasAccion({
  listas,
}: {
  listas: { id: string; etiqueta: string; total: number; filas: FilaAccion[] }[];
}) {
  const [actual, setActual] = useState(listas[0]?.id ?? '');
  const [visibles, setVisibles] = useState(10);
  const lista = listas.find((l) => l.id === actual) ?? listas[0];
  return (
    <section aria-label="Listas para actuar" className="seccion">
      <div className="seccion__cabecera" style={{ paddingBottom: 0 }}>
        <h2 className="seccion__titulo">Para actuar ahora</h2>
        <div role="tablist" aria-label="Listas" className="pestanas">
          {listas.map((l) => (
            <button
              key={l.id}
              type="button"
              role="tab"
              id={`tab-${l.id}`}
              aria-selected={l.id === actual}
              aria-controls="panel-listas"
              className="pestana"
              onClick={() => {
                setActual(l.id);
                setVisibles(10);
              }}
            >
              {l.etiqueta} · {l.total}
            </button>
          ))}
        </div>
      </div>
      <div
        id="panel-listas"
        role="tabpanel"
        aria-labelledby={`tab-${actual}`}
        style={{ display: 'flex', flexDirection: 'column', padding: '12px 24px 20px' }}
      >
        {!lista?.filas.length && <p className="vacio">Nada pendiente en esta lista.</p>}
        {lista?.filas.slice(0, visibles).map((f, n) => (
          <div key={`${f.conversationId}-${n}`} className="accion">
            <div className="accion__canal" aria-label={f.canal ?? 'canal desconocido'}>
              {CANAL[f.canal ?? ''] ?? '—'}
            </div>
            <div className="accion__textos">
              <span className="accion__contacto">{f.contacto}</span>
              {f.mensaje && <span className="accion__mensaje">{f.mensaje}</span>}
            </div>
            <span className="accion__asesor">
              {f.asesor ? nombreCorto(f.asesor) : 'Sin asesor'}
            </span>
            <span className={`pildora pildora--${f.urgente ? 'rojo' : 'amarillo'}`}>
              {f.espera}
            </span>
            {f.enlace && (
              <a className="enlace-ghl" href={f.enlace} target="_blank" rel="noopener noreferrer">
                Abrir en GHL <IconoExterno />
              </a>
            )}
          </div>
        ))}
        {lista && lista.filas.length > visibles && (
          <button
            type="button"
            className="boton-sec"
            style={{ alignSelf: 'flex-start', marginTop: 12 }}
            onClick={() => setVisibles(visibles + 10)}
          >
            Mostrar 10 más
          </button>
        )}
        {lista && lista.filas.length > 0 && (
          <p className="seccion__nota" style={{ marginTop: 12 }}>
            {lista.id === 'sin' ? 'Los más recientes primero' : 'Los de más espera primero'} ·{' '}
            {Math.min(visibles, lista.filas.length)} de {lista.total}
            {lista.total > lista.filas.length
              ? ` (se cargan los primeros ${lista.filas.length})`
              : ''}
            .
          </p>
        )}
      </div>
    </section>
  );
}
