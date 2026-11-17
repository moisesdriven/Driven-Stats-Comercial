import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { EtapaProceso } from '@driven/core';
import {
  Alerta,
  BarrasEtapa,
  Kpi,
  Leyenda,
  PildoraCuello,
  Vacio,
  VentasPorDia,
} from '@/componentes/panel/Bloques';
import { FiltroPeriodo } from '@/componentes/panel/Filtros';
import { destacadoEtapa, sufijoTiempo, type Presentacion } from '@/lib/destacado';
import { dias, haceCuanto, minutos, numero, porcentaje, rangoFechas, soles } from '@/lib/formato';
import { diasDelPeriodo, leerPeriodo, qsPeriodo } from '@/lib/periodo';
import {
  ETAPAS_ORDEN,
  NOMBRE_ETAPA,
  PREGUNTA_ETAPA,
  textoEstadoEtapa,
  tonoDe,
} from '@/lib/semaforo';
import { ultimaActualizacion } from '@/servidor/consultas/actualizacion';
import { vistaGeneral } from '@/servidor/consultas/indicadores';
import { obtenerDb } from '@/servidor/db';
import { enPagina, inicioDe, requerirSesionPagina } from '@/servidor/pagina';

export const metadata = { title: 'Vista general · Driven Comercial' };

const ARTICULO: Record<EtapaProceso, string> = {
  atencion: 'la atención',
  seguimiento: 'el seguimiento',
  negociacion: 'la negociación',
  cierre: 'el cierre',
};

export default async function VistaGeneral({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirSesionPagina();
  if (ctx.modulos.vista_general === 'ninguno') redirect(inicioDe(ctx));
  const periodo = leerPeriodo(await searchParams);
  const db = obtenerDb();
  const [v, actualizado] = await enPagina(
    Promise.all([
      vistaGeneral(db, ctx, periodo.desde, periodo.hasta),
      ultimaActualizacion(db, ctx.subcuentas),
    ]),
  );
  const qs = qsPeriodo(periodo);
  const i = 'indicadores' in v ? v.indicadores : null;
  const ev = 'evaluacion' in v ? v.evaluacion : null;
  const pres: Presentacion | null =
    'metas' in v
      ? { metas: v.metas, dias: diasDelPeriodo(periodo).length, corrido: v.corrido }
      : null;
  const lab = sufijoTiempo(pres?.corrido ?? false);
  const unDia = pres?.corrido ? 'Más de 24 horas' : 'Más de 1 día laboral';
  const etiquetaAgencia = ctx.rol === 'admin' ? 'de la agencia' : 'de tus subcuentas';

  return (
    <>
      <header className="encabezado">
        <div className="encabezado__textos">
          <h1 className="titulo">Vista general</h1>
          <p className="subtitulo">
            {v.subcuentas.length} {v.subcuentas.length === 1 ? 'subcuenta' : 'subcuentas'} ·{' '}
            {numero(i?.leadsRecibidos ?? 0)} leads · {rangoFechas(periodo.desde, periodo.hasta)}
            {actualizado ? ` · actualizado ${haceCuanto(actualizado).toLowerCase()}` : ''}
          </p>
        </div>
        <div className="filtros">
          <FiltroPeriodo clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} />
          {ctx.modulos.exportar !== 'ninguno' && (
            <a
              className="boton"
              href={`/api/exportar?tipo=vista-general&desde=${periodo.desde}&hasta=${periodo.hasta}`}
              download
            >
              Exportar
            </a>
          )}
        </div>
      </header>

      {!i || !ev ? (
        <Vacio>Aún no hay subcuentas con datos. Da de alta una subcuenta en Configuración.</Vacio>
      ) : (
        <>
          <section aria-label="Evaluación por etapa" className="oscura">
            <div className="fila-cabecera" style={{ flexWrap: 'wrap', alignItems: 'baseline' }}>
              <h2 className="seccion__titulo">
                {ev.cuello
                  ? `El cuello de botella ${etiquetaAgencia} está en ${ARTICULO[ev.cuello]}`
                  : `Sin cuello de botella ${etiquetaAgencia}`}
              </h2>
              <span className="oscura__nota">Semáforo frente a la meta de cada subcuenta</span>
            </div>
            <div className="rejilla rejilla--etapas">
              {ETAPAS_ORDEN.map((e, n) => {
                const estado = ev.etapas[e];
                const d = destacadoEtapa(e, ev.estados, i, pres!);
                return (
                  <div
                    key={e}
                    className={`etapa-oscura${estado === 'rojo' ? ' etapa-oscura--rojo' : ''}`}
                  >
                    <div className="fila-cabecera">
                      <span className="etapa-oscura__nombre">
                        {n + 1} · {NOMBRE_ETAPA[e]}
                      </span>
                      <span className={`pildora pildora--${tonoDe(estado)}`}>
                        {textoEstadoEtapa(estado)}
                      </span>
                    </div>
                    <span className="etapa-oscura__pregunta">{PREGUNTA_ETAPA[e]}</span>
                    <span className="etapa-oscura__valor">{d.valor}</span>
                    <span className="etapa-oscura__detalle">
                      {d.etiqueta} · {d.meta}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section aria-label="Indicadores" className="rejilla rejilla--kpis">
            <Kpi
              etiqueta="Tiempo de respuesta"
              valor={minutos(i.tiempoRespuestaMediana)}
              meta={`Mediana de ${numero(i.respuestasAsesor)} respuestas del asesor · ${numero(i.respuestasIa)} ganadas por el agente IA · meta ${numero(pres!.metas.tiempoRespuestaMin, 1)} min${lab}`}
              estado={ev.estados.tiempoRespuesta}
            />
            <Kpi
              etiqueta="Leads sin responder"
              valor={numero(i.sinResponder)}
              meta={`Sin respuesta del asesor ni del agente IA · ${numero(i.enEspera)} en espera`}
              estado={ev.estados.sinResponder}
            />
            <Kpi
              etiqueta="Pendientes de seguimiento"
              valor={numero(i.seguimientoVencido)}
              meta={`${unDia} sin contacto · ${numero(i.seguimientoProgramado)} programados`}
              estado={ev.estados.pendientes}
            />
            <Kpi
              etiqueta="Tasa de conversión"
              valor={porcentaje(i.conversion)}
              meta={`Meta: ${numero(pres!.metas.conversionPct, 1)} % · ${numero(i.ventas)} de ${numero(i.leadsRecibidos)} leads`}
              estado={ev.estados.conversion}
            />
            <Kpi
              etiqueta="Tiempo de cierre"
              valor={dias(i.tiempoCierreDias)}
              meta={`Meta: ${numero(pres!.metas.tiempoCierreDias, 1)} días${lab}`}
              estado={ev.estados.tiempoCierre}
            />
            <Kpi
              etiqueta="Ticket promedio"
              valor={soles(i.ticketPromedio)}
              meta="Monto de ventas ÷ ventas"
              referencia
            />
            <Kpi
              etiqueta="Ventas concretadas"
              valor={numero(i.ventas)}
              meta={`${soles(i.montoVentas)} · ${numero(i.ventasPorDia, 1)} por día${i.ventasCanceladas ? ` · ${i.ventasCanceladas} canceladas` : ''}`}
              estado={ev.estados.ventasVsMeta}
              referencia={ev.estados.ventasVsMeta === null}
            />
            <Kpi
              etiqueta="Leads perdidos"
              valor={numero(i.perdidos)}
              meta={`${numero(i.perdidosFaltaSeguimiento)} por falta de seguimiento`}
              referencia
            />
          </section>

          <section aria-label="Subcuentas" className="seccion">
            <div className="seccion__cabecera">
              <h2 className="seccion__titulo">Subcuentas</h2>
              <Leyenda />
            </div>
            <div className="tabla-caja">
              <table className="tabla" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th scope="col">Subcuenta</th>
                    <th scope="col">Leads</th>
                    <th scope="col">T. respuesta</th>
                    <th scope="col">Sin responder</th>
                    <th scope="col">Pendientes</th>
                    <th scope="col">Conversión</th>
                    <th scope="col">Ventas</th>
                    <th scope="col">Etapas A · S · N · C</th>
                    <th scope="col">Cuello de botella</th>
                  </tr>
                </thead>
                <tbody>
                  {v.subcuentas.map((s) => (
                    <tr key={s.locationId}>
                      <td>
                        {ctx.modulos.vista_subcuenta !== 'ninguno' ? (
                          <Link href={`/subcuentas/${s.locationId}${qs}`}>{s.nombre}</Link>
                        ) : (
                          <strong>{s.nombre}</strong>
                        )}
                      </td>
                      <td>{numero(s.indicadores.leadsRecibidos)}</td>
                      <td>{minutos(s.indicadores.tiempoRespuestaMediana)}</td>
                      <td>{numero(s.indicadores.sinResponder)}</td>
                      <td>{numero(s.indicadores.seguimientoVencido)}</td>
                      <td>{porcentaje(s.indicadores.conversion)}</td>
                      <td style={{ fontWeight: 600 }}>{numero(s.indicadores.ventas)}</td>
                      <td>
                        <BarrasEtapa etapas={s.evaluacion.etapas} />
                      </td>
                      <td>
                        <PildoraCuello cuello={s.evaluacion.cuello} etapas={s.evaluacion.etapas} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="rejilla rejilla--dos">
            <section
              aria-label="Ventas diarias"
              className="seccion seccion--relleno"
              style={{ gap: 16 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 className="seccion__titulo seccion__titulo--chico">
                  Ventas concretadas por día
                </h2>
                <span className="seccion__nota">
                  {numero(i.ventas)} ventas · promedio de {numero(i.ventasPorDia, 1)} por día
                </span>
              </div>
              <VentasPorDia dias={diasDelPeriodo(periodo)} porDia={v.ventasPorDia} />
            </section>
            <section aria-label="Alertas cruzadas" className="seccion seccion--relleno">
              <h2 className="seccion__titulo seccion__titulo--chico">Alertas cruzadas</h2>
              {v.subcuentas.flatMap((s) =>
                s.evaluacion.alertas.map((a) => (
                  <Alerta key={`${s.locationId}-${a}`} quien={s.nombre} clave={a} />
                )),
              )}
              {!v.subcuentas.some((s) => s.evaluacion.alertas.length) && (
                <Vacio>Sin alertas cruzadas en el periodo.</Vacio>
              )}
            </section>
          </div>
        </>
      )}
    </>
  );
}
