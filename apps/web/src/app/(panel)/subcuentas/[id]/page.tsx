import Link from 'next/link';
import { Suspense } from 'react';
import { NOMBRES_CATEGORIA, CRITERIOS, type CategoriaCalidad } from '@driven/core';
import { KpiChico, Pildora, Vacio } from '@/componentes/panel/Bloques';
import { FiltroPeriodo, SelectorSubcuenta } from '@/componentes/panel/Filtros';
import { IconoDescarga } from '@/componentes/panel/Iconos';
import { ListasAccion } from '@/componentes/panel/ListasAccion';
import { TablaAsesores } from '@/componentes/panel/TablaAsesores';
import {
  calidad,
  dias,
  mesAnio,
  minutos,
  nombreCorto,
  numero,
  porcentaje,
  rangoFechas,
  soles,
} from '@/lib/formato';
import { leerPeriodo, qsPeriodo } from '@/lib/periodo';
import { NOMBRE_ETAPA, tonoDe } from '@/lib/semaforo';
import { peoresMensajes } from '@/servidor/calidad';
import { indicadoresSubcuenta } from '@/servidor/consultas/indicadores';
import { ESPERA_FUERA_DE_TURNO, listasParaActuar } from '@/servidor/consultas/listas';
import { subcuentasMenu } from '@/servidor/consultas/menu';
import type { ContextoAcceso } from '@/servidor/acceso';
import { obtenerDb } from '@/servidor/db';
import { enPagina, exigirSubcuentaPagina, requerirModuloPagina } from '@/servidor/pagina';

export const metadata = { title: 'Vista por subcuenta · Driven Comercial' };

const TEXTO_CRITERIO: Record<string, string> = {
  responde: 'no responde la pregunta',
  personalizado: 'sin personalizar',
  siguiente_paso: 'sin siguiente paso',
  tono: 'tono u ortografía',
  extension: 'extensión inadecuada',
};

export default async function VistaSubcuenta({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirModuloPagina('vista_subcuenta');
  const { id } = await params;
  exigirSubcuentaPagina(ctx, id);
  const periodo = leerPeriodo(await searchParams);
  const db = obtenerDb();
  const [d, peores, opciones] = await enPagina(
    Promise.all([
      indicadoresSubcuenta(db, ctx, id, periodo.desde, periodo.hasta),
      peoresMensajes(db, ctx, id),
      subcuentasMenu(db, ctx),
    ]),
  );
  const i = d.indicadores;
  const ev = d.evaluacion;
  const qs = qsPeriodo(periodo);
  const verAsesores = ctx.modulos.detalle_asesores !== 'ninguno';
  const motivos = Object.entries(i.perdidosPorMotivo)
    .map(([k, n]) => ({
      etiqueta:
        k === 'sin_motivo'
          ? 'Sin motivo registrado'
          : k === 'abandonada'
            ? 'Abandonada'
            : (d.motivosPerdida[k] ?? 'Otro motivo'),
      n,
    }))
    .sort((a, b) => b.n - a.n);
  const maxMotivo = Math.max(1, ...motivos.map((m) => m.n));
  const asesores = [...d.asesores]
    .filter((a) => a.indicadores.leadsRecibidos || a.indicadores.ventas || a.indicadores.perdidos)
    .sort((a, b) => b.indicadores.leadsRecibidos - a.indicadores.leadsRecibidos);

  return (
    <>
      <header style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <nav aria-label="Ruta" className="migas">
          {ctx.modulos.vista_general !== 'ninguno' && (
            <>
              <Link href={`/${qs}`}>Vista general</Link>
              <span aria-hidden="true">›</span>
            </>
          )}
          <span>{d.subcuenta.nombre}</span>
        </nav>
        <div className="encabezado">
          <div className="encabezado__textos">
            <div className="encabezado__fila">
              <h1 className="titulo">{d.subcuenta.nombre}</h1>
              {ev.cuello ? (
                <Pildora tono={tonoDe(ev.etapas[ev.cuello])} icono>
                  Cuello de botella: {NOMBRE_ETAPA[ev.cuello].toLowerCase()}
                </Pildora>
              ) : (
                <Pildora tono="verde" icono>
                  Sin cuello de botella
                </Pildora>
              )}
            </div>
            <p className="subtitulo">
              {asesores.length} {asesores.length === 1 ? 'asesor' : 'asesores'} ·{' '}
              {numero(i.leadsRecibidos)} leads · {rangoFechas(periodo.desde, periodo.hasta)}
            </p>
          </div>
          <div className="filtros">
            {opciones.length > 1 && (
              <SelectorSubcuenta
                actual={id}
                opciones={opciones.map((o) => ({ id: o.locationId, nombre: o.nombre }))}
                plantilla="/subcuentas/{id}"
              />
            )}
            <FiltroPeriodo clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} />
            {ctx.modulos.exportar !== 'ninguno' && (
              <a
                className="boton-sec"
                href={`/api/exportar?tipo=subcuenta&subcuenta=${encodeURIComponent(id)}&desde=${periodo.desde}&hasta=${periodo.hasta}`}
                download
              >
                <IconoDescarga />
                Exportar
              </a>
            )}
          </div>
        </div>
      </header>

      <section aria-label="Indicadores de la subcuenta" className="rejilla rejilla--kpis-chicos">
        <KpiChico
          etiqueta="T. respuesta"
          valor={minutos(i.tiempoRespuestaMediana)}
          estado={ev.estados.tiempoRespuesta}
        />
        <KpiChico
          etiqueta="Ganadas por IA"
          valor={`${numero(i.respuestasIa)}${i.respuestasIaPct !== null ? ` · ${porcentaje(i.respuestasIaPct, 0)}` : ''}`}
        />
        <KpiChico
          etiqueta="Sin responder"
          valor={numero(i.sinResponder)}
          estado={ev.estados.sinResponder}
        />
        <KpiChico
          etiqueta="Pendientes"
          valor={numero(i.seguimientoVencido)}
          estado={ev.estados.pendientes}
        />
        <KpiChico etiqueta="Calidad" valor={calidad(i.calidad)} estado={ev.estados.calidad} />
        <KpiChico
          etiqueta="Conversión"
          valor={porcentaje(i.conversion)}
          estado={ev.estados.conversion}
        />
        <KpiChico
          etiqueta="Tiempo de cierre"
          valor={dias(i.tiempoCierreDias)}
          estado={ev.estados.tiempoCierre}
        />
        <KpiChico etiqueta="Ticket promedio" valor={soles(i.ticketPromedio)} referencia />
        <KpiChico
          etiqueta="Ventas"
          valor={numero(i.ventas)}
          estado={ev.estados.ventasVsMeta}
          referencia={ev.estados.ventasVsMeta === null}
        />
        <KpiChico etiqueta="Perdidos" valor={numero(i.perdidos)} referencia />
      </section>

      <TablaAsesores
        asesores={asesores}
        corrido={d.corrido}
        enlace={verAsesores ? (a) => `/subcuentas/${id}/asesores/${a}${qs}` : null}
      />

      <Suspense fallback={<ListasCargando />}>
        <Listas ctx={ctx} id={id} />
      </Suspense>

      <div className="rejilla rejilla--dos">
        <section aria-label="Motivos de pérdida" className="seccion seccion--relleno">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="seccion__titulo seccion__titulo--chico">Por qué se pierden los leads</h2>
            <span className="seccion__nota">
              {numero(i.perdidos)} leads perdidos en el periodo ·{' '}
              {numero(i.perdidosFaltaSeguimiento)} por falta de seguimiento
            </span>
          </div>
          {!motivos.length && <Vacio>Sin leads perdidos en el periodo.</Vacio>}
          {motivos.map((m) => (
            <div key={m.etiqueta} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                <span>{m.etiqueta}</span>
                <span style={{ fontWeight: 600 }}>{m.n}</span>
              </div>
              <div className="progreso">
                <div
                  className={
                    m.etiqueta === 'Sin motivo registrado' ? 'progreso--naranja' : undefined
                  }
                  style={{ width: `${Math.round((m.n / maxMotivo) * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </section>

        <section aria-label="Mensajes con menor puntaje" className="seccion seccion--relleno">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <h2 className="seccion__titulo seccion__titulo--chico">Mensajes para mejorar</h2>
            <span className="seccion__nota">
              {peores.analisis
                ? `Menor puntaje en el último análisis (muestra de ${numero(peores.analisis.muestra)} conversaciones · ${mesAnio(peores.analisis.periodoDesde)})`
                : ctx.modulos.texto_mensajes === 'ninguno'
                  ? 'Tu usuario no tiene acceso al texto de los mensajes.'
                  : 'Aún no hay un análisis de calidad terminado.'}
            </span>
          </div>
          {peores.mensajes.map((m, n) => (
            <div key={n} className="mensaje-mejorar">
              <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--gris)' }}>
                  {nombreCorto(m.asesor) || 'Asesor'} ·{' '}
                  {NOMBRES_CATEGORIA[m.categoria as CategoriaCalidad] ?? m.categoria}
                </span>
                <Pildora tono="rojo">{m.puntaje} / 5</Pildora>
              </div>
              <span style={{ fontSize: 14 }}>“{m.texto}”</span>
              <span style={{ fontSize: 12, color: 'var(--gris)' }}>
                {m.motivo}
                {m.criterios
                  ? ` · Falta: ${
                      CRITERIOS.filter((c) => !m.criterios![c])
                        .map((c) => TEXTO_CRITERIO[c])
                        .join(', ') || 'nada'
                    }`
                  : ''}
              </span>
            </div>
          ))}
        </section>
      </div>
    </>
  );
}

/**
 * Listas para actuar: se calculan en vivo sobre los mensajes (la consulta más pesada de la
 * página), así que llegan por streaming sin retrasar los indicadores.
 */
async function Listas({ ctx, id }: { ctx: ContextoAcceso; id: string }) {
  const listas = await enPagina(listasParaActuar(obtenerDb(), ctx, id));
  return (
    <ListasAccion
      listas={[
        {
          id: 'sin',
          etiqueta: 'Sin responder',
          total: listas.totales.sinResponder,
          filas: listas.sinResponder.filter((f) => f.espera !== ESPERA_FUERA_DE_TURNO),
        },
        {
          id: 'fuera',
          etiqueta: 'Asesor fuera de turno',
          total: listas.totales.fueraDeTurno,
          filas: listas.sinResponder.filter((f) => f.espera === ESPERA_FUERA_DE_TURNO),
        },
        {
          id: 'pend',
          etiqueta: 'Pendientes de seguimiento',
          total: listas.totales.pendientes,
          filas: listas.pendientes,
        },
        {
          id: 'ayer',
          etiqueta: 'Interesados de ayer',
          total: listas.totales.interesados,
          filas: listas.interesados,
        },
      ]}
    />
  );
}

function ListasCargando() {
  return (
    <section aria-label="Listas para actuar" className="seccion" aria-busy="true">
      <div className="esqueleto" style={{ padding: 20 }}>
        <span className="oculto">Cargando listas…</span>
        <div className="esqueleto__linea" />
        <div className="esqueleto__bloque" />
      </div>
    </section>
  );
}
