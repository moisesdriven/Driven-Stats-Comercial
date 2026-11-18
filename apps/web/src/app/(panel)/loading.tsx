/**
 * Esqueleto que se muestra al instante al cambiar de módulo mientras el servidor calcula la página.
 * Next lo precarga con los enlaces del menú, así que el cambio se ve inmediato aunque los datos
 * tarden.
 */
export default function Cargando() {
  return (
    <div className="esqueleto" role="status" aria-live="polite">
      <span className="oculto">Cargando…</span>
      <div className="esqueleto__titulo" />
      <div className="esqueleto__linea" />
      <div className="rejilla rejilla--kpis">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="esqueleto__bloque" />
        ))}
      </div>
      <div className="esqueleto__bloque esqueleto__bloque--alto" />
    </div>
  );
}
