/** Bloques de presentación del diseño aprobado. Sin estado: sirven en páginas de servidor. */
import type { ReactNode } from 'react';
import type { EstadoSemaforo, EtapaProceso } from '@driven/core';
import { diaCorto } from '@/lib/formato';
import type { Destacado } from '@/lib/destacado';
import {
  ETAPAS_ORDEN,
  LETRA_ETAPA,
  NOMBRE_ETAPA,
  PREGUNTA_ETAPA,
  TEXTO_ALERTA,
  textoEstado,
  textoEstadoEtapa,
  textoLeyenda,
  tonoDe,
  type Tono,
} from '@/lib/semaforo';
import { IconoAlerta, IconoCirculoCheck, IconoInfo } from './Iconos';

/** Ícono del estado: nunca se indica solo con color (WCAG 1.4.1). */
export function IconoTono({ tono }: { tono: Tono }) {
  if (tono === 'rojo' || tono === 'amarillo') return <IconoAlerta tam={15} />;
  if (tono === 'verde') return <IconoCirculoCheck />;
  return <IconoInfo />;
}

export function Pildora({
  tono,
  children,
  icono = false,
}: {
  tono: Tono | 'negra';
  children: ReactNode;
  /** Agrega el ícono del estado (para píldoras que expresan un semáforo). */
  icono?: boolean;
}) {
  return (
    <span className={`pildora pildora--${tono}`}>
      {icono && tono !== 'negra' && <IconoTono tono={tono} />}
      {children}
    </span>
  );
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
      <IconoTono tono={tono} />
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

/** Indicador compacto (vista por subcuenta): el ícono lleva el estado en texto oculto y en el título. */
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
        {etiqueta}
        <span
          className={`estado estado--${tono}`}
          title={referencia ? 'Referencia' : textoEstado(estado)}
        >
          <IconoTono tono={tono} />
          <span className="oculto">({referencia ? 'referencia' : textoEstado(estado)})</span>
        </span>
      </span>
      <span className="kpi__valor">{valor}</span>
    </div>
  );
}

/** Etapas A · S · N · C: letra + símbolo (✓ cumple, ! debajo de la meta) y el estado en texto oculto. */
export function BarrasEtapa({ etapas }: { etapas: Record<EtapaProceso, EstadoSemaforo | null> }) {
  return (
    <span className="etapas">
      {ETAPAS_ORDEN.map((e) => (
        <span
          key={e}
          title={`${NOMBRE_ETAPA[e]}: ${textoLeyenda(etapas[e])}`}
          className={`etapa etapa--${tonoDe(etapas[e])}`}
        >
          <span aria-hidden="true">{LETRA_ETAPA[e]}</span>
          <span className="oculto">
            {NOMBRE_ETAPA[e]}: {textoLeyenda(etapas[e])}.
          </span>
        </span>
      ))}
    </span>
  );
}

export function PildoraCuello({
  cuello,
  etapas,
}: {
  cuello: EtapaProceso | null;
  etapas: Record<EtapaProceso, EstadoSemaforo | null>;
}) {
  if (!cuello)
    return (
      <Pildora tono="verde" icono>
        Sin cuello
      </Pildora>
    );
  return (
    <Pildora tono={tonoDe(etapas[cuello])} icono>
      {NOMBRE_ETAPA[cuello]}
    </Pildora>
  );
}

export function Leyenda() {
  return (
    <div className="leyenda">
      <span>
        <span className="etapa etapa--verde" aria-hidden="true">
          A
        </span>
        Cumple la meta
      </span>
      <span>
        <span className="etapa etapa--amarillo" aria-hidden="true">
          A
        </span>
        Hasta 20 % debajo
      </span>
      <span>
        <span className="etapa etapa--rojo" aria-hidden="true">
          A
        </span>
        Más de 20 % debajo
      </span>
      <span>
        <span className="etapa etapa--gris" aria-hidden="true">
          A
        </span>
        Sin dato
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
  datos: { etiqueta: string; valor: number; tono?: 'naranja'; detalle?: string }[];
  bajas?: boolean;
  etiqueta: string;
}) {
  const max = Math.max(1, ...datos.map((d) => d.valor));
  const alto = bajas ? 90 : 140;
  return (
    <figure
      style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: 16 }}
      aria-label={etiqueta}
    >
      <div className={`barras${bajas ? ' barras--bajas' : ''}`}>
        {datos.map((d) => (
          <div key={d.etiqueta} className="barras__col" tabIndex={0}>
            <span className="barras__tip" role="tooltip">
              {d.detalle ?? `${d.etiqueta}: ${d.valor}`}
            </span>
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

const ventasTexto = (n: number) => (n === 0 ? 'sin ventas' : n === 1 ? '1 venta' : `${n} ventas`);

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
    const semanas: { etiqueta: string; valor: number; detalle: string }[] = [];
    for (let i = 0; i < dias.length; i += 7) {
      const tramo = dias.slice(i, i + 7);
      const valor = tramo.reduce((t, d) => t + (mapa.get(d) ?? 0), 0);
      semanas.push({
        etiqueta: `Desde ${diaCorto(tramo[0]!)}`,
        valor,
        detalle: `Semana desde ${diaCorto(tramo[0]!)} · ${ventasTexto(valor)}`,
      });
    }
    return <GraficoBarras datos={semanas} etiqueta="Ventas concretadas por semana" />;
  }
  return (
    <GraficoBarras
      datos={dias.map((d) => {
        const valor = mapa.get(d) ?? 0;
        return { etiqueta: diaCorto(d), valor, detalle: `${diaCorto(d)} · ${ventasTexto(valor)}` };
      })}
      etiqueta="Ventas concretadas por día"
    />
  );
}

export function Alerta({ quien, clave }: { quien: string; clave: string }) {
  const a = TEXTO_ALERTA[clave] ?? { titulo: clave, detalle: '', tono: 'amarillo' as const };
  return (
    <div className="alerta">
      <div className={`alerta__icono alerta__icono--${a.tono === 'rojo' ? 'rojo' : 'amarillo'}`}>
        <IconoAlerta />
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

/**
 * Embudo comercial: las 4 etapas en orden, cada una con el indicador que explica su estado y una
 * barra de avance hacia la meta. La etapa que es el cuello de botella va resaltada.
 */
export function Embudo({
  titulo,
  aviso,
  cuello,
  etapas,
  destacados,
}: {
  titulo: string;
  aviso: ReactNode;
  cuello: EtapaProceso | null;
  etapas: Record<EtapaProceso, EstadoSemaforo | null>;
  destacados: Record<EtapaProceso, Destacado>;
}) {
  const tonoCuello = cuello ? tonoDe(etapas[cuello]) : 'verde';
  return (
    <section aria-labelledby="titulo-embudo" className="oscura embudo">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <h2 id="titulo-embudo" className="seccion__titulo">
          {titulo}
        </h2>
        <span className="oscura__nota">Cada etapa frente a la meta de la subcuenta</span>
      </div>
      <div className={`aviso-cuello aviso-cuello--${tonoCuello}`} role="note">
        <IconoTono tono={tonoCuello} />
        <div>{aviso}</div>
      </div>
      <ol className="pasos">
        {ETAPAS_ORDEN.map((e, n) => {
          const estado = etapas[e];
          const tono = tonoDe(estado);
          const d = destacados[e];
          const esCuello = e === cuello && (tono === 'rojo' || tono === 'amarillo');
          return (
            <li
              key={e}
              className={`paso${esCuello ? (tono === 'rojo' ? ' paso--cuello' : ' paso--cuello-amarillo') : ''}`}
              aria-current={esCuello ? 'step' : undefined}
            >
              <div className="fila-cabecera">
                <span className="paso__nombre">
                  {n + 1} · {NOMBRE_ETAPA[e]}
                </span>
                <Pildora tono={tono} icono>
                  {textoEstadoEtapa(estado)}
                </Pildora>
              </div>
              <span className="paso__pregunta">{PREGUNTA_ETAPA[e]}</span>
              <span className="paso__valor">{d.valor}</span>
              {d.avance !== null && (
                <div
                  className="medidor"
                  role="img"
                  aria-label={`${Math.round(d.avance)} % de la meta`}
                >
                  <div
                    className={`medidor__relleno${tono === 'verde' || tono === 'amarillo' ? ` medidor__relleno--${tono}` : ''}`}
                    style={{ width: `${Math.max(2, d.avance)}%` }}
                  />
                  <div className="medidor__meta" />
                </div>
              )}
              <span className="paso__detalle">
                {d.etiqueta} · {d.meta.charAt(0).toLowerCase() + d.meta.slice(1)}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
