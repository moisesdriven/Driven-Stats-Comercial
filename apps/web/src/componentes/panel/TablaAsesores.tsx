import Link from 'next/link';
import type { evaluar, calcularIndicadores } from '@driven/core';
import { iniciales, minutos, nombreCorto, numero, porcentaje } from '@/lib/formato';
import { BarrasEtapa, Leyenda, PildoraCuello, Vacio } from './Bloques';

export interface FilaAsesor {
  asesorId: string;
  nombre: string;
  indicadores: ReturnType<typeof calcularIndicadores>;
  evaluacion: ReturnType<typeof evaluar>;
}

/** Tabla de asesores de una subcuenta (vista de subcuenta y módulo Asesores). */
export function TablaAsesores({
  asesores,
  corrido,
  enlace,
  titulo = 'Asesores',
}: {
  asesores: FilaAsesor[];
  corrido: boolean;
  /** Enlace al detalle de cada asesor; `null` si el usuario no puede verlo. */
  enlace: ((asesorId: string) => string) | null;
  titulo?: string;
}) {
  return (
    <section id="asesores" aria-label="Asesores" className="seccion">
      <div className="seccion__cabecera">
        <h2 className="seccion__titulo">{titulo}</h2>
        <span className="seccion__nota">
          {corrido
            ? 'Tiempos medidos en tiempo corrido (24 horas, todos los días)'
            : 'Tiempos medidos en el horario laboral de cada asesor'}
        </span>
      </div>
      {!asesores.length ? (
        <div style={{ padding: '0 20px 20px' }}>
          <Vacio>Sin actividad de asesores en el periodo.</Vacio>
        </div>
      ) : (
        <div
          className="tabla-caja tabla-caja--apilable"
          tabIndex={0}
          role="region"
          aria-label="Tabla de asesores"
        >
          <table className="tabla" style={{ minWidth: 960 }}>
            <thead>
              <tr>
                <th scope="col">Asesor</th>
                <th scope="col" className="n">
                  Leads
                </th>
                <th scope="col" className="n">
                  T. respuesta
                </th>
                <th scope="col" className="n">
                  Sin responder
                </th>
                <th scope="col" className="n">
                  Pendientes
                </th>
                <th scope="col" className="n">
                  Calidad
                </th>
                <th scope="col" className="n">
                  Conversión
                </th>
                <th scope="col" className="n">
                  Ventas
                </th>
                <th scope="col">Etapas A · S · N · C</th>
                <th scope="col">Cuello de botella</th>
              </tr>
            </thead>
            <tbody>
              {asesores.map((a) => (
                <tr key={a.asesorId}>
                  <td>
                    {enlace ? (
                      <Link href={enlace(a.asesorId)} className="con-avatar">
                        <span className="avatar-chico" aria-hidden="true">
                          {iniciales(a.nombre)}
                        </span>
                        {nombreCorto(a.nombre)}
                      </Link>
                    ) : (
                      <span className="con-avatar">{nombreCorto(a.nombre)}</span>
                    )}
                  </td>
                  <td className="n" data-etiqueta="Leads">
                    {numero(a.indicadores.leadsRecibidos)}
                  </td>
                  <td className="n" data-etiqueta="T. respuesta">
                    {minutos(a.indicadores.tiempoRespuestaMediana)}
                  </td>
                  <td className="n" data-etiqueta="Sin responder">
                    {numero(a.indicadores.sinResponder)}
                  </td>
                  <td className="n" data-etiqueta="Pendientes">
                    {numero(a.indicadores.seguimientoVencido)}
                  </td>
                  <td className="n" data-etiqueta="Calidad">
                    {a.indicadores.calidad === null ? '—' : numero(a.indicadores.calidad, 1)}
                  </td>
                  <td className="n" data-etiqueta="Conversión">
                    {porcentaje(a.indicadores.conversion)}
                  </td>
                  <td className="n" data-etiqueta="Ventas" style={{ fontWeight: 600 }}>
                    {numero(a.indicadores.ventas)}
                  </td>
                  <td data-etiqueta="Etapas">
                    <BarrasEtapa etapas={a.evaluacion.etapas} />
                  </td>
                  <td data-etiqueta="Cuello de botella">
                    <PildoraCuello cuello={a.evaluacion.cuello} etapas={a.evaluacion.etapas} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ padding: '4px 20px 18px' }}>
        <Leyenda />
      </div>
    </section>
  );
}
