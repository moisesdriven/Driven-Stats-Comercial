import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { EtapaProceso } from '@driven/core';
import {
  Alerta,
  BarrasEtapa,
  Embudo,
  Kpi,
  Leyenda,
  PildoraCuello,
  Vacio,
  VentasPorDia,
} from '@/componentes/panel/Bloques';
import { FiltroCanal, FiltroPeriodo } from '@/componentes/panel/Filtros';
import { IconoDescarga } from '@/componentes/panel/Iconos';
import { leerCanal, nombreCanal } from '@/lib/canales';
import { destacadoEtapa, sufijoTiempo, type Presentacion } from '@/lib/destacado';
import { dias, haceCuanto, minutos, numero, porcentaje, rangoFechas, soles } from '@/lib/formato';
import { diasDelPeriodo, leerPeriodo, qsPeriodo } from '@/lib/periodo';
import { ETAPAS_ORDEN, NOMBRE_ETAPA } from '@/lib/semaforo';
import { ultimaActualizacion } from '@/servidor/consultas/actualizacion';
import { vistaGeneral } from '@/servidor/consultas/indicadores';
import { obtenerDb } from '@/servidor/db';
import { enPagina, inicioDe, requerirSesionPagina } from '@/servidor/pagina';

export const metadata = { title: 'Vista general · Driven Comercial' };

export default async function VistaGeneral({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirSesionPagina();
  if (ctx.modulos.vista_general === 'ninguno') redirect(inicioDe(ctx));
  const params = await searchParams;
  const periodo = leerPeriodo(params);
  const canal = leerCanal(params);
  const db = obtenerDb();
  const [v, actualizado] = await enPagina(
    Promise.all([
      vistaGeneral(db, ctx, periodo.desde, periodo.hasta, canal),
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
            {numero(i?.leadsRecibidos ?? 0)} leads{canal ? ` por ${nombreCanal(canal)}` : ''} ·{' '}
            {rangoFechas(periodo.desde, periodo.hasta)}
            {actualizado ? ` · actualizado ${haceCuanto(actualizado).toLowerCase()}` : ''}
          </p>
        </div>
        <div className="filtros">
          {v.canales.length > 0 && (
            <FiltroCanal
              actual={canal}
              canales={v.canales.map((c) => ({ valor: c, texto: nombreCanal(c) }))}
            />
          )}
          <FiltroPeriodo
            clave={periodo.clave}
            desde={periodo.desde}
            hasta={periodo.hasta}
            hoy={periodo.hoy}
          />
          {ctx.modulos.exportar !== 'ninguno' && (
            <a
              className="boton-sec"
              href={`/api/exportar?tipo=vista-general&desde=${periodo.desde}&hasta=${periodo.hasta}${canal ? `&canal=${encodeURIComponent(canal)}` : ''}`}
              download
            >
              <IconoDescarga />
              Exportar
            </a>
          )}
        </div>
      </header>

      {!i || !ev ? (
        <Vacio>Aún no hay subcuentas con datos. Da de alta una subcuenta en Configuración.</Vacio>
      ) : (
        <>
          {(() => {
            const destacados = Object.fromEntries(
              ETAPAS_ORDEN.map((e) => [e, destacadoEtapa(e, ev.estados, i, pres!)]),
            ) as Record<EtapaProceso, ReturnType<typeof destacadoEtapa>>;
            const d = ev.cuello ? destacados[ev.cuello] : null;
            return (
              <Embudo
                titulo={`Embudo comercial ${etiquetaAgencia}`}
                cuello={ev.cuello}
                etapas={ev.etapas}
                destacados={destacados}
                aviso={
                  ev.cuello && d ? (
                    <>
                      <strong>Cuello de botella: {NOMBRE_ETAPA[ev.cuello]}.</strong> {d.etiqueta}:{' '}
                      {d.valor} ({d.meta.charAt(0).toLowerCase() + d.meta.slice(1)}). Mejorar aquí
                      destraba las etapas siguientes.
                    </>
                  ) : (
                    <>
                      <strong>Sin cuello de botella.</strong> Todas las etapas están en meta.
                    </>
                  )
                }
              />
            );
          })()}

          <section aria-label="Indicadores" className="rejilla rejilla--kpis">
            <Kpi
              etiqueta="Tiempo de respuesta"
              valor={minutos(i.tiempoRespuestaMediana)}
              meta={`Mediana de ${numero(i.respuestasAsesor)} respuestas del asesor · ${numero(i.respuestasIa)} del agente IA y ${numero(i.respuestasWorkflow)} del workflow · meta ${numero(pres!.metas.tiempoRespuestaMin, 1)} min`}
              estado={ev.estados.tiempoRespuesta}
            />
            <Kpi
              etiqueta="Leads sin responder"
              valor={numero(i.sinResponder)}
              meta={`15 min o más sin respuesta de nadie, asesor en turno · ${numero(i.fueraDeTurno)} con el asesor fuera de turno`}
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
            </div>
            <div
              className="tabla-caja tabla-caja--apilable"
              tabIndex={0}
              role="region"
              aria-label="Tabla de subcuentas"
            >
              <table className="tabla" style={{ minWidth: 880 }}>
                <thead>
                  <tr>
                    <th scope="col">Subcuenta</th>
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
                  {v.subcuentas.map((s) => (
                    <tr key={s.locationId}>
                      <td>
                        {ctx.modulos.vista_subcuenta !== 'ninguno' ? (
                          <Link href={`/subcuentas/${s.locationId}${qs}`}>{s.nombre}</Link>
                        ) : (
                          <strong>{s.nombre}</strong>
                        )}
                      </td>
                      <td className="n" data-etiqueta="Leads">
                        {numero(s.indicadores.leadsRecibidos)}
                      </td>
                      <td className="n" data-etiqueta="T. respuesta">
                        {minutos(s.indicadores.tiempoRespuestaMediana)}
                      </td>
                      <td className="n" data-etiqueta="Sin responder">
                        {numero(s.indicadores.sinResponder)}
                      </td>
                      <td className="n" data-etiqueta="Pendientes">
                        {numero(s.indicadores.seguimientoVencido)}
                      </td>
                      <td className="n" data-etiqueta="Conversión">
                        {porcentaje(s.indicadores.conversion)}
                      </td>
                      <td className="n" data-etiqueta="Ventas" style={{ fontWeight: 600 }}>
                        {numero(s.indicadores.ventas)}
                      </td>
                      <td data-etiqueta="Etapas">
                        <BarrasEtapa etapas={s.evaluacion.etapas} />
                      </td>
                      <td data-etiqueta="Cuello de botella">
                        <PildoraCuello cuello={s.evaluacion.cuello} etapas={s.evaluacion.etapas} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '4px 20px 18px' }}>
              <Leyenda />
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
              <h2 className="seccion__titulo seccion__titulo--chico">Alertas</h2>
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
