'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';
import { CRITERIOS, NOMBRES_CATEGORIA, type CategoriaCalidad } from '@driven/core';
import { fechaLarga, mesAnio, numero } from '@/lib/formato';
import { IconoCerrar, IconoCheck, IconoExterno, IconoMensaje } from './Iconos';

const NOMBRE_CRITERIO: Record<string, string> = {
  responde: 'Responde lo que el cliente preguntó',
  personalizado: 'Está personalizado',
  siguiente_paso: 'Incluye un siguiente paso claro',
  tono: 'Tono y ortografía correctos',
  extension: 'Extensión adecuada para WhatsApp',
};

interface Ejemplo {
  tipo: 'mejor' | 'peor';
  texto: string | null;
  mensajePrevioCliente: string | null;
  categoria: string;
  puntaje: number | null;
  criterios: Record<string, boolean> | null;
  motivo: string | null;
  clienteRespondio: boolean;
  huboVenta: boolean;
  enlace: string | null;
  fecha: string;
}

interface Respuesta {
  analisis: {
    periodoDesde: string;
    muestra: number | null;
    promedio: number | null;
    etapas: string[];
  } | null;
  ejemplos: Ejemplo[];
}

interface Estado {
  abierto: boolean;
  alternar: () => void;
  cerrar: () => void;
  permitido: boolean;
  datos: Respuesta | null;
  error: string | null;
  nombre: string;
}

const Contexto = createContext<Estado>({
  abierto: false,
  alternar: () => {},
  cerrar: () => {},
  permitido: false,
  datos: null,
  error: null,
  nombre: '',
});

/** Estado compartido del panel de ejemplos: lo abren la tarjeta de Negociación y la fila de calidad. */
export function ProveedorEjemplos({
  children,
  url,
  permitido,
  nombre,
}: {
  children: ReactNode;
  url: string;
  permitido: boolean;
  nombre: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [datos, setDatos] = useState<Respuesta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alternar = async () => {
    const nuevo = !abierto;
    setAbierto(nuevo);
    if (nuevo && !datos) {
      const r = await fetch(url, { credentials: 'same-origin' });
      if (r.ok) setDatos((await r.json()) as Respuesta);
      else
        setError(
          ((await r.json().catch(() => ({}))) as { error?: string }).error ??
            'No se pudieron cargar los ejemplos.',
        );
    }
    if (nuevo)
      setTimeout(
        () =>
          document
            .getElementById('ejemplos-calidad')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
        50,
      );
  };
  return (
    <Contexto.Provider
      value={{
        abierto,
        alternar,
        cerrar: () => setAbierto(false),
        permitido,
        datos,
        error,
        nombre,
      }}
    >
      {children}
    </Contexto.Provider>
  );
}

export function BotonEjemplos({
  variante = 'tarjeta',
  children,
}: {
  variante?: 'tarjeta' | 'fila';
  children?: ReactNode;
}) {
  const { abierto, alternar, permitido } = useContext(Contexto);
  if (!permitido) return variante === 'fila' ? <>{children}</> : null;
  if (variante === 'fila') {
    return (
      <button
        type="button"
        className="enlace-subrayado"
        onClick={alternar}
        aria-expanded={abierto}
        aria-controls="ejemplos-calidad"
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="button"
      className="boton-sec boton-sec--azul"
      style={{ alignSelf: 'flex-start', minHeight: 40, whiteSpace: 'nowrap', padding: '0 14px' }}
      onClick={alternar}
      aria-expanded={abierto}
      aria-controls="ejemplos-calidad"
    >
      <IconoMensaje /> {abierto ? 'Ocultar ejemplos' : 'Ver mejor y peor mensaje'}
    </button>
  );
}

/** Lugar de la página donde aparece el panel de ejemplos al abrirlo. */
export function RanuraEjemplos() {
  const { abierto, datos, error, nombre, cerrar } = useContext(Contexto);
  if (!abierto) return null;
  return (
    <section id="ejemplos-calidad" aria-label="Ejemplos de calidad de mensajes" className="oscura">
      <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="seccion__titulo">Su mejor y su peor mensaje del último análisis</h2>
          <span style={{ fontSize: 13, color: '#B4BCCC' }}>
            {datos?.analisis
              ? `Calidad promedio ${numero(datos.analisis.promedio, 1)} / 5 · muestra de ${numero(datos.analisis.muestra)} conversaciones · ${mesAnio(datos.analisis.periodoDesde)} · etapas: ${datos.analisis.etapas.join(', ')}`
              : (error ??
                (datos
                  ? 'Aún no hay un análisis de calidad terminado para esta subcuenta.'
                  : 'Cargando…'))}
          </span>
        </div>
        <button type="button" className="boton-icono" onClick={cerrar} aria-label="Cerrar ejemplos">
          <IconoCerrar />
        </button>
      </div>
      {datos && datos.ejemplos.length === 0 && datos.analisis && (
        <p className="aviso aviso--oscuro">
          Este asesor no tuvo mensajes calificados en el último análisis.
        </p>
      )}
      <div className="rejilla rejilla--dos">
        {datos?.ejemplos.map((m) => {
          const mejor = m.tipo === 'mejor';
          const color = mejor
            ? { acento: '#12B76A', fondo: '#E7F8EF', texto: '#067647' }
            : { acento: '#F04438', fondo: '#FDECEA', texto: '#B42318' };
          return (
            <article key={m.tipo} className="ejemplo" style={{ borderTopColor: color.acento }}>
              <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.06em',
                    textTransform: 'uppercase',
                    color: color.texto,
                  }}
                >
                  {mejor ? 'Mensaje de mayor calidad' : 'Mensaje de menor calidad'}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--titulos)',
                    fontSize: 22,
                    fontWeight: 700,
                    padding: '2px 12px',
                    borderRadius: 999,
                    background: color.fondo,
                    color: color.texto,
                  }}
                >
                  {m.puntaje ?? '—'} / 5
                </span>
              </div>
              <span style={{ fontSize: 12, color: '#5B6475' }}>
                {fechaLarga(String(m.fecha).slice(0, 10))} ·{' '}
                {NOMBRES_CATEGORIA[m.categoria as CategoriaCalidad] ?? m.categoria}
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {m.mensajePrevioCliente && (
                  <div className="burbuja burbuja--cliente">
                    <span className="burbuja__quien">Cliente</span>
                    {m.mensajePrevioCliente}
                  </div>
                )}
                <div
                  className="burbuja burbuja--asesor"
                  style={
                    mejor
                      ? {
                          background: 'linear-gradient(135deg, #1F5BFF 0%, #4D7CFF 100%)',
                          color: '#fff',
                        }
                      : { background: '#F0F3F9', color: '#0B0D12' }
                  }
                >
                  <span className="burbuja__quien">{nombre}</span>
                  {m.texto}
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  paddingTop: 4,
                  borderTop: '1px solid #EDF0F6',
                }}
              >
                {CRITERIOS.map((c) => {
                  const ok = Boolean(m.criterios?.[c]);
                  return (
                    <span key={c} className="criterio">
                      <span
                        className="criterio__icono"
                        style={{ background: ok ? '#E7F8EF' : '#FDECEA' }}
                        role="img"
                        aria-label={ok ? 'Cumple' : 'No cumple'}
                      >
                        {ok ? (
                          <IconoCheck color="#067647" />
                        ) : (
                          <span style={{ color: '#B42318', fontWeight: 700, fontSize: 12 }}>✕</span>
                        )}
                      </span>
                      {NOMBRE_CRITERIO[c]}
                    </span>
                  );
                })}
              </div>
              {m.motivo && <span style={{ fontSize: 13, color: '#3A4252' }}>{m.motivo}</span>}
              <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: color.texto }}>
                  {m.clienteRespondio ? 'El cliente respondió' : 'El cliente no volvió a escribir'}
                  {m.huboVenta ? ' y compró' : ''}
                </span>
                {m.enlace && (
                  <a
                    className="enlace-ghl"
                    href={m.enlace}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver conversación <IconoExterno />
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
