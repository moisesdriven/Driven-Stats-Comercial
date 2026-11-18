'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { Metas } from '@driven/core';
import { IconoCheck } from './Iconos';

type Campo = {
  clave: string;
  etiqueta: string;
  ayuda: string;
  unidad: string;
  paso: number;
  min: number;
  max: number;
  opcional?: boolean;
};

const GRUPOS: { etapa: string; pregunta: string; campos: Campo[] }[] = [
  {
    etapa: 'Atención',
    pregunta: '¿Responde rápido?',
    campos: [
      {
        clave: 'tiempoRespuestaMin',
        etiqueta: 'Tiempo de respuesta del asesor',
        ayuda: 'Mediana en minutos, desde que el asesor está en jornada',
        unidad: 'min',
        paso: 0.5,
        min: 0.5,
        max: 1440,
      },
      {
        clave: 'sinResponder.tolerancia',
        etiqueta: 'Leads sin responder',
        ayuda: 'Meta 0 · amarillo hasta',
        unidad: 'leads',
        paso: 1,
        min: 0,
        max: 1000,
      },
    ],
  },
  {
    etapa: 'Seguimiento',
    pregunta: '¿Insiste lo suficiente?',
    campos: [
      {
        clave: 'cumplimientoSeguimientoPct',
        etiqueta: 'Cumplimiento de seguimiento',
        ayuda: 'Leads contactados a tiempo',
        unidad: '%',
        paso: 1,
        min: 1,
        max: 100,
      },
      {
        clave: 'pendientes.tolerancia',
        etiqueta: 'Pendientes de seguimiento',
        ayuda: 'Meta 0 · amarillo hasta',
        unidad: 'leads',
        paso: 1,
        min: 0,
        max: 1000,
      },
      {
        clave: 'intentosPorLead',
        etiqueta: 'Intentos de contacto por lead',
        ayuda: 'Promedio mínimo',
        unidad: 'intentos',
        paso: 0.5,
        min: 0.5,
        max: 20,
      },
      {
        clave: 'perdidosFaltaSeguimiento.tolerancia',
        etiqueta: 'Perdidos por falta de seguimiento',
        ayuda: 'Meta 0 · amarillo hasta',
        unidad: 'leads',
        paso: 1,
        min: 0,
        max: 1000,
      },
    ],
  },
  {
    etapa: 'Negociación',
    pregunta: '¿Sus mensajes convencen?',
    campos: [
      {
        clave: 'calidad',
        etiqueta: 'Calidad de mensajes',
        ayuda: 'Puntaje promedio de 1 a 5',
        unidad: '/ 5',
        paso: 0.1,
        min: 1,
        max: 5,
      },
      {
        clave: 'respuestaEfectivaPct',
        etiqueta: 'Respuesta efectiva',
        ayuda: 'Mensajes que el cliente responde',
        unidad: '%',
        paso: 1,
        min: 1,
        max: 100,
      },
      {
        clave: 'abandonosPctMax',
        etiqueta: 'Abandonos',
        ayuda: 'Máximo aceptable',
        unidad: '%',
        paso: 1,
        min: 0,
        max: 100,
      },
    ],
  },
  {
    etapa: 'Cierre',
    pregunta: '¿Concreta la venta?',
    campos: [
      {
        clave: 'conversionPct',
        etiqueta: 'Tasa de conversión',
        ayuda: 'Leads que terminan en venta',
        unidad: '%',
        paso: 0.1,
        min: 0.1,
        max: 100,
      },
      {
        clave: 'tiempoCierreDias',
        etiqueta: 'Tiempo de cierre',
        ayuda: 'Días desde el ingreso hasta la venta',
        unidad: 'días',
        paso: 0.5,
        min: 0.5,
        max: 365,
      },
      {
        clave: 'ventasPorSemana',
        etiqueta: 'Ventas por semana',
        ayuda: 'Vacío = sin meta de ventas',
        unidad: 'ventas',
        paso: 1,
        min: 1,
        max: 100000,
        opcional: true,
      },
    ],
  },
];

const leer = (m: Metas, clave: string): number | null => {
  const [a, b] = clave.split('.') as [keyof Metas, string | undefined];
  const v = m[a] as unknown;
  return b ? ((v as Record<string, number>)[b] ?? null) : (v as number | null);
};

interface Etapa {
  stageId: string;
  nombre: string;
  pipeline: string | null;
  estandar: string | null;
}

interface Props {
  locationId: string;
  /** Nombre de la subcuenta: metas y etapas de calidad son propias de cada una. */
  nombreSubcuenta: string;
  /** La subcuenta aún no tiene metas propias (usa las de Driven por defecto). */
  porDefecto: boolean;
  /** Otras subcuentas del usuario con metas propias, para copiarlas. */
  otras: { id: string; nombre: string; metas: Metas }[];
  metas: Metas;
  etapas: Etapa[];
  etapasCalidad: string[];
  puedeEditar: boolean;
}

/** Valores del formulario (texto) a partir de unas metas. */
function valoresDe(metas: Metas): Record<string, string> {
  return {
    ...(Object.fromEntries(
      GRUPOS.flatMap((g) => g.campos).map((c) => [c.clave, leer(metas, c.clave)?.toString() ?? '']),
    ) as Record<string, string>),
    toleranciaRelativa: String(Math.round(metas.toleranciaRelativa * 100)),
  };
}

export function FormularioMetas({
  locationId,
  nombreSubcuenta,
  porDefecto,
  otras,
  metas,
  etapas,
  etapasCalidad,
  puedeEditar,
}: Props) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, string>>(() => valoresDe(metas));
  const [origen, setOrigen] = useState(otras[0]?.id ?? '');
  const [calidad, setCalidad] = useState<string[]>(etapasCalidad);
  const [msgMetas, setMsgMetas] = useState<{
    tipo: 'ok' | 'error' | 'info';
    texto: string;
  } | null>(null);
  const [msgCalidad, setMsgCalidad] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(
    null,
  );

  const n = (k: string) => Number(valores[k]);
  const guardarMetas = async () => {
    setMsgMetas(null);
    const cuerpo = {
      tiempoRespuestaMin: n('tiempoRespuestaMin'),
      sinResponder: { meta: 0, tolerancia: n('sinResponder.tolerancia') },
      pendientes: { meta: 0, tolerancia: n('pendientes.tolerancia') },
      cumplimientoSeguimientoPct: n('cumplimientoSeguimientoPct'),
      intentosPorLead: n('intentosPorLead'),
      perdidosFaltaSeguimiento: { meta: 0, tolerancia: n('perdidosFaltaSeguimiento.tolerancia') },
      calidad: n('calidad'),
      respuestaEfectivaPct: n('respuestaEfectivaPct'),
      abandonosPctMax: n('abandonosPctMax'),
      conversionPct: n('conversionPct'),
      tiempoCierreDias: n('tiempoCierreDias'),
      ventasPorSemana: valores.ventasPorSemana?.trim() ? n('ventasPorSemana') : null,
      toleranciaRelativa: n('toleranciaRelativa') / 100,
    };
    const r = await fetch(`/api/subcuentas/${locationId}/metas`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setMsgMetas(
      r.ok
        ? {
            tipo: 'ok',
            texto: `Metas de ${nombreSubcuenta} guardadas. Su semáforo ya usa los valores nuevos.`,
          }
        : { tipo: 'error', texto: d.error ?? 'No se pudieron guardar las metas.' },
    );
    if (r.ok) router.refresh();
  };

  const guardarCalidad = async () => {
    setMsgCalidad(null);
    const r = await fetch(`/api/subcuentas/${locationId}/etapas-calidad`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ etapas: calidad }),
    });
    const d = (await r.json().catch(() => ({}))) as { error?: string };
    setMsgCalidad(
      r.ok
        ? {
            tipo: 'ok',
            texto: `Etapas de ${nombreSubcuenta} guardadas. Se usan desde su siguiente análisis de calidad.`,
          }
        : { tipo: 'error', texto: d.error ?? 'No se pudieron guardar las etapas.' },
    );
    if (r.ok) router.refresh();
  };

  return (
    <>
      <form
        className="seccion seccion--relleno"
        aria-label="Metas y umbrales"
        onSubmit={(e) => {
          e.preventDefault();
          void guardarMetas();
        }}
      >
        <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="seccion__titulo">Metas y umbrales</h2>
            <span className="seccion__nota">
              Verde: en meta. Amarillo: dentro del margen. Rojo: fuera del margen.
            </span>
          </div>
          {puedeEditar && <button className="boton">Guardar metas</button>}
        </div>
        {porDefecto && (
          <p className="aviso aviso--info">
            {nombreSubcuenta} todavía usa las metas por defecto de Driven. Ajústalas a este equipo
            {otras.length ? ' o copia las de otra subcuenta' : ''} y pulsa «Guardar metas».
          </p>
        )}
        {puedeEditar && otras.length > 0 && (
          <div className="copiar-metas">
            <label className="filtro">
              Copiar metas de
              <select
                className="control"
                value={origen}
                onChange={(e) => setOrigen(e.target.value)}
              >
                {otras.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.nombre}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="boton-sec"
              onClick={() => {
                const o = otras.find((x) => x.id === origen);
                if (!o) return;
                setValores(valoresDe(o.metas));
                setMsgMetas({
                  tipo: 'info',
                  texto: `Copiadas las metas de ${o.nombre}. Revisa los valores y pulsa «Guardar metas» para aplicarlas a ${nombreSubcuenta}.`,
                });
              }}
            >
              Copiar
            </button>
          </div>
        )}
        {msgMetas && (
          <p className={`aviso aviso--${msgMetas.tipo}`} role="status">
            {msgMetas.texto}
          </p>
        )}
        <fieldset
          disabled={!puedeEditar}
          style={{
            border: 0,
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div className="metas-caja">
            <div className="rejilla--metas">
              {GRUPOS.map((g) => (
                <fieldset key={g.etapa} className="grupo-metas">
                  <legend>
                    <span className="etapa-clara__nombre">{g.etapa}</span>{' '}
                    <span style={{ fontSize: 13, color: 'var(--gris)', fontWeight: 400 }}>
                      {g.pregunta}
                    </span>
                  </legend>
                  {g.campos.map((c) => (
                    <label key={c.clave} className="fila-meta">
                      <span
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          flex: '1 1 0',
                          minWidth: 0,
                        }}
                      >
                        <span style={{ fontWeight: 600, fontSize: 14 }}>{c.etiqueta}</span>
                        <span style={{ fontSize: 12, color: 'var(--gris)' }}>{c.ayuda}</span>
                      </span>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          className="control"
                          style={{ width: 96, textAlign: 'right' }}
                          type="number"
                          inputMode="decimal"
                          step={c.paso}
                          min={c.min}
                          max={c.max}
                          required={!c.opcional}
                          value={valores[c.clave] ?? ''}
                          onChange={(e) => setValores({ ...valores, [c.clave]: e.target.value })}
                        />
                        <span style={{ fontSize: 13, color: 'var(--gris)', minWidth: 52 }}>
                          {c.unidad}
                        </span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ))}
            </div>
          </div>
          <label className="fila-meta" style={{ maxWidth: 560 }}>
            <span style={{ display: 'flex', flexDirection: 'column', flex: '1 1 0', minWidth: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Margen para el amarillo</span>
              <span style={{ fontSize: 12, color: 'var(--gris)' }}>
                Cuánto puede alejarse de la meta antes de pasar a rojo (indicadores con meta
                distinta de 0)
              </span>
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                className="control"
                style={{ width: 96, textAlign: 'right' }}
                type="number"
                step={1}
                min={5}
                max={50}
                required
                value={valores.toleranciaRelativa}
                onChange={(e) => setValores({ ...valores, toleranciaRelativa: e.target.value })}
              />
              <span style={{ fontSize: 13, color: 'var(--gris)', minWidth: 52 }}>%</span>
            </span>
          </label>
        </fieldset>
      </form>

      <form
        className="seccion seccion--relleno"
        aria-label="Etapas de calidad"
        onSubmit={(e) => {
          e.preventDefault();
          void guardarCalidad();
        }}
      >
        <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="seccion__titulo">Etapas de calidad</h2>
            <span className="seccion__nota">
              Elige las 3 etapas del pipeline de {nombreSubcuenta} cuyos mensajes se califican.{' '}
              {calidad.length} de 3 elegidas.
            </span>
          </div>
          {puedeEditar && (
            <button className="boton" disabled={calidad.length !== 3}>
              Guardar etapas
            </button>
          )}
        </div>
        {etapasCalidad.length !== 3 && !msgCalidad && (
          <p className="aviso aviso--info">
            {nombreSubcuenta} aún no tiene sus 3 etapas de calidad: hasta elegirlas no se analiza la
            calidad de sus mensajes (ni manual ni mensual).
          </p>
        )}
        {msgCalidad && (
          <p className={`aviso aviso--${msgCalidad.tipo}`} role="status">
            {msgCalidad.texto}
          </p>
        )}
        {etapas.length === 0 ? (
          <p className="vacio">Aún no se cargaron las etapas del pipeline de esta subcuenta.</p>
        ) : (
          <div
            className="rejilla"
            style={{
              gridTemplateColumns: 'repeat(auto-fill, minmax(min(260px, 100%), 1fr))',
              gap: 8,
            }}
          >
            {etapas.map((e) => {
              const on = calidad.includes(e.stageId);
              const lleno = !on && calidad.length >= 3;
              return (
                <button
                  key={e.stageId}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={!puedeEditar || lleno}
                  className={`opcion-clara${on ? ' opcion-clara--on' : ''}`}
                  onClick={() =>
                    setCalidad(
                      on ? calidad.filter((x) => x !== e.stageId) : [...calidad, e.stageId],
                    )
                  }
                >
                  <span
                    className={`caja-check caja-check--clara${on ? ' caja-check--on' : ''}`}
                    aria-hidden="true"
                  >
                    {on && <IconoCheck />}
                  </span>
                  <span
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'flex-start',
                      minWidth: 0,
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{e.nombre}</span>
                    <span style={{ fontSize: 12, color: 'var(--gris)' }}>
                      {[e.pipeline, e.estandar ? `cuenta como ${e.estandar}` : 'sin etapa estándar']
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </form>
    </>
  );
}
