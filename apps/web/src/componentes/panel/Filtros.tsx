'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** Filtro de periodo: el selector de fechas con atajos y calendario (cambia la URL y la página recalcula). */
export { SelectorFechas as FiltroPeriodo } from './SelectorFechas';

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
