'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

const OPCIONES = [
  { valor: 'hoy', texto: 'Hoy' },
  { valor: '7d', texto: '7 días' },
  { valor: 'mes', texto: 'Este mes' },
  { valor: 'rango', texto: 'Rango' },
];

/** Filtro de periodo (hoy, últimos 7 días, este mes, rango): cambia la URL y la página recalcula. */
export function FiltroPeriodo({
  clave,
  desde,
  hasta,
}: {
  clave: string;
  desde: string;
  hasta: string;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const [rango, setRango] = useState({ desde, hasta });
  const ir = (cambios: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const qs = p.toString();
    router.push(qs ? `${ruta}?${qs}` : ruta);
  };
  return (
    <>
      <fieldset className="segmentos">
        <legend>Periodo</legend>
        {OPCIONES.map((o) => (
          <label key={o.valor}>
            <input
              type="radio"
              name="periodo"
              value={o.valor}
              checked={clave === o.valor}
              onChange={() => {
                if (o.valor === 'rango')
                  ir({ periodo: 'rango', desde: rango.desde, hasta: rango.hasta });
                else ir({ periodo: o.valor === '7d' ? null : o.valor, desde: null, hasta: null });
              }}
            />
            <span>{o.texto}</span>
          </label>
        ))}
      </fieldset>
      {clave === 'rango' && (
        <>
          <label className="filtro">
            Desde
            <input
              className="control"
              type="date"
              value={rango.desde}
              max={rango.hasta}
              onChange={(e) => setRango({ ...rango, desde: e.target.value })}
            />
          </label>
          <label className="filtro">
            Hasta
            <input
              className="control"
              type="date"
              value={rango.hasta}
              min={rango.desde}
              onChange={(e) => setRango({ ...rango, hasta: e.target.value })}
            />
          </label>
          <button
            type="button"
            className="boton-sec"
            onClick={() => ir({ periodo: 'rango', desde: rango.desde, hasta: rango.hasta })}
          >
            Aplicar
          </button>
        </>
      )}
    </>
  );
}

/** Selector de subcuenta: navega a la ruta de la subcuenta elegida conservando el periodo. */
/** `plantilla` es la ruta con `{id}` donde va la subcuenta, p. ej. "/subcuentas/{id}". */
export function SelectorSubcuenta({
  actual,
  opciones,
  plantilla,
  conservarPeriodo = true,
}: {
  actual: string;
  opciones: { id: string; nombre: string }[];
  plantilla: string;
  conservarPeriodo?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  return (
    <label className="filtro">
      Subcuenta
      <select
        className="control"
        value={actual}
        onChange={(e) => {
          // La subcuenta va en la plantilla (ruta o `?subcuenta=`); el resto de la consulta se conserva.
          const resto = new URLSearchParams(conservarPeriodo ? params.toString() : '');
          resto.delete('subcuenta');
          const base = plantilla.replace('{id}', encodeURIComponent(e.target.value));
          const qs = resto.toString();
          router.push(qs ? `${base}${base.includes('?') ? '&' : '?'}${qs}` : base);
        }}
      >
        {opciones.map((o) => (
          <option key={o.id} value={o.id}>
            {o.nombre}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Filtro por canal de la vista general (§10.2): solo los canales con datos. */
export function FiltroCanal({
  actual,
  canales,
}: {
  actual: string | null;
  canales: { valor: string; texto: string }[];
}) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  return (
    <label className="filtro">
      <span className="oculto">Canal</span>
      <select
        className="control"
        value={actual ?? ''}
        onChange={(e) => {
          const p = new URLSearchParams(params.toString());
          if (e.target.value) p.set('canal', e.target.value);
          else p.delete('canal');
          const qs = p.toString();
          router.push(qs ? `${ruta}?${qs}` : ruta);
        }}
      >
        <option value="">Todos los canales</option>
        {canales.map((c) => (
          <option key={c.valor} value={c.valor}>
            {c.texto}
          </option>
        ))}
      </select>
    </label>
  );
}
