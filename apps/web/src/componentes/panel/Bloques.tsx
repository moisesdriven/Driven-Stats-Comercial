/** Bloques de presentación del diseño aprobado. Sin estado: sirven en páginas de servidor. */
import type { ReactNode } from 'react';
import type { EstadoSemaforo, EtapaProceso } from '@driven/core';
import { diaCorto } from '@/lib/formato';
import {
  COLORES,
  ETAPAS_ORDEN,
  NOMBRE_ETAPA,
  TEXTO_ALERTA,
  textoEstado,
  textoLeyenda,
  tonoDe,
  type Tono,
} from '@/lib/semaforo';
import { IconoAlerta } from './Iconos';

export function Pildora({ tono, children }: { tono: Tono | 'negra'; children: ReactNode }) {
  return <span className={`pildora pildora--${tono}`}>{children}</span>;
}

export function Estado({
  estado,
  referencia = false,
}: {
  estado: EstadoSemaforo | null | undefined;
  referencia?: boolean;
}) {
  const tono: Tono = referencia ? 'azul' : tonoDe(estado);
  return (
    <span className={`estado estado--${tono}`}>
      <span className={`punto punto--${tono}`} aria-hidden="true" />
      {referencia ? 'Referencia' : textoEstado(estado)}
    </span>
  );
}

export function Kpi({
  etiqueta,
  valor,
  meta,
  estado,
  referencia = false,
}: {
  etiqueta: string;
  valor: string;
  meta?: string;
  estado?: EstadoSemaforo | null;
  referencia?: boolean;
}) {
  return (
    <div className="kpi">
      <div className="kpi__cabecera">
        <span className="kpi__etiqueta">{etiqueta}</span>
        <Estado estado={estado} referencia={referencia} />
      </div>
      <span className="kpi__valor">{valor}</span>
      {meta && <span className="kpi__meta">{meta}</span>}
    </div>
  );
}

/** Indicador compacto (vista por subcuenta): el punto lleva el estado en texto para lectores de pantalla. */
export function KpiChico({
  etiqueta,
  valor,
  estado,
  referencia = false,
}: {
  etiqueta: string;
  valor: string;
  estado?: EstadoSemaforo | null;
  referencia?: boolean;
}) {
  const tono: Tono = referencia ? 'azul' : tonoDe(estado);
  return (
    <div className="kpi kpi--chico">
      <span className="kpi__etiqueta">
        <span className={`punto punto--${tono}`} aria-hidden="true" />
        {etiqueta}
        <span className="oculto">({referencia ? 'referencia' : textoEstado(estado)})</span>
      </span>
      <span className="kpi__valor">{valor}</span>
    </div>
  );
}

/** Las 4 barritas de etapa (A · S · N · C) con su estado en el título y en texto oculto. */
export function BarrasEtapa({ etapas }: { etapas: Record<EtapaProceso, EstadoSemaforo | null> }) {
  return (
    <div className="barras-etapa">
      {ETAPAS_ORDEN.map((e) => (
        <span
          key={e}
          title={`${NOMBRE_ETAPA[e]}: ${textoLeyenda(etapas[e])}`}
          className="barra-etapa"
          style={{ background: COLORES[tonoDe(etapas[e])] }}
        >
          <span className="oculto">
            {NOMBRE_ETAPA[e]}: {textoLeyenda(etapas[e])}.
          </span>
        </span>
      ))}
    </div>
  );
}

export function PildoraCuello({
  cuello,
  etapas,
}: {
  cuello: EtapaProceso | null;
  etapas: Record<EtapaProceso, EstadoSemaforo | null>;
}) {
  if (!cuello) return <Pildora tono="verde">Sin cuello</Pildora>;
  return <Pildora tono={tonoDe(etapas[cuello])}>{NOMBRE_ETAPA[cuello]}</Pildora>;
}

export function Leyenda() {
  return (
    <div className="leyenda">
      <span>
        <span className="punto punto--verde" aria-hidden="true" />
        Cumple
      </span>
      <span>
        <span className="punto punto--amarillo" aria-hidden="true" />
        Hasta 20 % debajo
      </span>
      <span>
        <span className="punto punto--rojo" aria-hidden="true" />
        Más de 20 % debajo
      </span>
    </div>
  );
}

/** Gráfico de barras simple y accesible (cada barra lleva su valor visible). */
export function GraficoBarras({
  datos,
  bajas = false,
  etiqueta,
}: {
  datos: { etiqueta: string; valor: number; tono?: 'naranja' }[];
  bajas?: boolean;
  etiqueta: string;
}) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const alto = bajas ? 96 : 140;
  return (
    <figure
      style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}
      aria-label={etiqueta}
    >
      <div className={`barras${bajas ? ' barras--bajas' : ''}`}>
        {datos.map((d) => (
          <div key={d.etiqueta} className="barras__col">
            <span className="barras__valor">{d.valor}</span>
            <div
              className={`barras__barra${d.tono ? ' barras__barra--naranja' : ''}`}
              style={{ height: Math.max(2, Math.round((d.valor / max) * alto)) }}
            />
          </div>
        ))}
      </div>
      <div className="barras__etiquetas">
        {datos.map((d) => (
          <span key={d.etiqueta}>{d.etiqueta}</span>
        ))}
      </div>
    </figure>
  );
}

export function VentasPorDia({
  dias,
  porDia,
}: {
  dias: string[];
  porDia: { fecha: string; ventas: number }[];
}) {
  const mapa = new Map(porDia.map((d) => [d.fecha, d.ventas]));
  // Para periodos largos se agrupan las barras por semana para que sigan siendo legibles.
  if (dias.length > 14) {
    const semanas: { etiqueta: string; valor: number }[] = [];
    for (let i = 0; i < dias.length; i += 7) {
      const tramo = dias.slice(i, i + 7);
      semanas.push({
        etiqueta: `Desde ${diaCorto(tramo[0]!)}`,
        valor: tramo.reduce((t, d) => t + (mapa.get(d) ?? 0), 0),
      });
    }
    return <GraficoBarras datos={semanas} etiqueta="Ventas concretadas por semana" />;
  }
  return (
    <GraficoBarras
      datos={dias.map((d) => ({ etiqueta: diaCorto(d), valor: mapa.get(d) ?? 0 }))}
      etiqueta="Ventas concretadas por día"
    />
  );
}

export function Alerta({ quien, clave }: { quien: string; clave: string }) {
  const a = TEXTO_ALERTA[clave] ?? { titulo: clave, detalle: '', tono: 'amarillo' as const };
  const fondo = a.tono === 'rojo' ? '#FDECEA' : '#FEF3E2';
  const color = a.tono === 'rojo' ? '#B42318' : '#93370D';
  return (
    <div className="alerta">
      <div className="alerta__icono" style={{ background: fondo }}>
        <IconoAlerta color={color} />
      </div>
      <div className="alerta__textos">
        <span className="alerta__quien">{quien}</span>
        <span className="alerta__titulo">{a.titulo}</span>
        <span className="alerta__detalle">{a.detalle}</span>
      </div>
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="vacio">{children}</p>;
}
