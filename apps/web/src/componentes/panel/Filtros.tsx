'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

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
      <label className="filtro">
        Periodo
        <select
          className="control"
          value={clave}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'rango') ir({ periodo: 'rango', desde: rango.desde, hasta: rango.hasta });
            else ir({ periodo: v === '7d' ? null : v, desde: null, hasta: null });
          }}
        >
          <option value="7d">Últimos 7 días</option>
          <option value="hoy">Hoy</option>
          <option value="mes">Este mes</option>
          <option value="rango">Rango de fechas</option>
        </select>
      </label>
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
          const qs = conservarPeriodo ? params.toString() : '';
          router.push(
            `${plantilla.replace('{id}', encodeURIComponent(e.target.value))}${qs ? `?${qs}` : ''}`,
          );
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
