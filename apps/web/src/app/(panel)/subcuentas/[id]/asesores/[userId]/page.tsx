import Link from 'next/link';
import {
  fechaLocal,
  tramosDelDia,
  NOMBRES_CATEGORIA,
  type CategoriaCalidad,
  type ClaveIndicador,
} from '@driven/core';
import { GraficoBarras, Pildora } from '@/componentes/panel/Bloques';
import {
  BotonEjemplos,
  ProveedorEjemplos,
  RanuraEjemplos,
} from '@/componentes/panel/DetalleAsesor';
import { FiltroPeriodo } from '@/componentes/panel/Filtros';
import { IconoReloj } from '@/componentes/panel/Iconos';
import { describir, destacadoEtapa, fraseCuello } from '@/lib/destacado';
import {
  calidad,
  dias,
  iniciales,
  mesAnio,
  minutos,
  nombreCorto,
  numero,
  porcentaje,
  rangoFechas,
  soles,
} from '@/lib/formato';
import { leerPeriodo, qsPeriodo } from '@/lib/periodo';
import { COLORES, ETAPAS_ORDEN, NOMBRE_ETAPA, textoEstado, tonoDe } from '@/lib/semaforo';
import { indicadoresAsesor } from '@/servidor/consultas/indicadores';
import { tiemposSubcuenta } from '@/servidor/consultas/tiempo';
import { obtenerDb } from '@/servidor/db';
import { enPagina, exigirSubcuentaPagina, requerirModuloPagina } from '@/servidor/pagina';
import { sql } from 'drizzle-orm';

export const metadata = { title: 'Detalle del asesor · Driven Comercial' };

const COLORES_TIPO = [
  '#1F5BFF',
  '#6E93FF',
  '#0B0D12',
  '#5B6475',
  '#B9C6E4',
  '#12B76A',
  '#F79009',
  '#D5DBE7',
];

export default async function DetalleAsesor({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; userId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirModuloPagina('detalle_asesores');
  const { id, userId } = await params;
  exigirSubcuentaPagina(ctx, id);
  const periodo = leerPeriodo(await searchParams);
  const db = obtenerDb();
  const d = await enPagina(indicadoresAsesor(db, ctx, id, userId, periodo.desde, periodo.hasta));
  const [sub] = (
    await db.execute<{ nombre: string; zona_horaria: string }>(
      sql`select nombre, zona_horaria from comercial.subcuentas where location_id = ${id}`,
    )
  ).rows;
  const zona = sub?.zona_horaria ?? 'America/Lima';
  const tiempo = (await tiemposSubcuenta(db, id, zona))(userId);
  const tramosHoy = tramosDelDia(tiempo.horario, fechaLocal(new Date(), zona));
  const i = d.indicadores;
  const s = d.subcuenta;
  const ev = d.evaluacion;
  const qs = qsPeriodo(periodo);
  const nombre = nombreCorto(d.asesor.nombre);
  const n = Math.max(1, d.asesoresConLeads);
  const cuello = ev.cuello;
  const dCuello = cuello ? destacadoEtapa(cuello, ev.estados, i) : null;
  const tonoCuello = cuello ? tonoDe(ev.etapas[cuello]) : 'verde';

  const fila = (
    etiqueta: string,
    clave: ClaveIndicador | null,
    valor: string,
    meta: string,
    prom: string,
    esCalidad = false,
  ) => ({ etiqueta, clave, valor, meta, prom, esCalidad });
  const tabla = [
    fila(
      'Tiempo de respuesta',
      'tiempoRespuesta',
      minutos(i.tiempoRespuestaMediana),
      '5 min',
      minutos(s.tiempoRespuestaMediana),
    ),
    fila('Calidad de mensajes', 'calidad', calidad(i.calidad), '3,5', calidad(s.calidad), true),
    fila(
      'Leads sin responder',
      'sinResponder',
      numero(i.sinResponder),
      '0',
      numero(s.sinResponder / n, 1),
    ),
    fila(
      'Pendientes de seguimiento',
      'pendientes',
      numero(i.seguimientoVencido),
      '0',
      numero(s.seguimientoVencido / n, 1),
    ),
    fila(
      'Tasa de conversión',
      'conversion',
      porcentaje(i.conversion),
      '12 %',
      porcentaje(s.conversion),
    ),
    fila(
      'Tiempo de cierre',
      'tiempoCierre',
      dias(i.tiempoCierreDias),
      '3 días',
      dias(s.tiempoCierreDias),
    ),
    fila(
      'Ventas concretadas',
      'ventasVsMeta',
      `${numero(i.ventas)} · ${soles(i.montoVentas)}`,
      '—',
      numero(s.ventas / n, 1),
    ),
    fila('Leads perdidos', null, numero(i.perdidos), '—', numero(s.perdidos / n, 1)),
  ];
  const tipos = Object.entries(d.distribucionCalidad ?? {}).sort((a, b) => b[1] - a[1]);
  const totalTipos = tipos.reduce((t, [, v]) => t + v, 0);

  return (
    <ProveedorEjemplos
      url={`/api/subcuentas/${id}/asesores/${userId}/calidad`}
      permitido={ctx.modulos.texto_mensajes !== 'ninguno'}
      nombre={nombre}
    >
      <nav aria-label="Ruta" className="migas">
        {ctx.modulos.vista_general !== 'ninguno' && (
          <>
            <Link href={`/${qs}`}>Vista general</Link>
            <span aria-hidden="true">›</span>
          </>
        )}
        {ctx.modulos.vista_subcuenta !== 'ninguno' ? (
          <Link href={`/subcuentas/${id}${qs}`}>{sub?.nombre}</Link>
        ) : (
          <span>{sub?.nombre}</span>
        )}
        <span aria-hidden="true">›</span>
        <span>{nombre}</span>
      </nav>

      <div className="encabezado" style={{ justifyContent: 'flex-end' }}>
        <div className="filtros">
          <FiltroPeriodo clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} />
        </div>
      </div>

      <section aria-label="Resumen del asesor" className="resumen-asesor">
        <div className="resumen-asesor__persona">
          <div className="avatar-grande" aria-hidden="true">
            {iniciales(nombre)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <h1 className="titulo" style={{ fontSize: 30 }}>
              {nombre}
            </h1>
            <span style={{ fontSize: 14, color: '#B4BCCC' }}>
              {sub?.nombre} · {numero(i.leadsRecibidos)} leads ·{' '}
              {rangoFechas(periodo.desde, periodo.hasta)}
            </span>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                color: '#B4BCCC',
              }}
            >
              <IconoReloj tam={16} color="#8FB0FF" />
              {tramosHoy.length
                ? `Horario hoy: ${tramosHoy.map((t) => `${t.inicio} a ${t.fin}`).join(' y ')}`
                : 'Hoy no tiene horario laboral'}
            </span>
          </div>
        </div>
        <div
          className={`cuello-tarjeta${tonoCuello === 'rojo' ? ' cuello-tarjeta--rojo' : tonoCuello === 'amarillo' ? ' cuello-tarjeta--amarillo' : ''}`}
        >
          <span
            className="cuello-tarjeta__etiqueta"
            style={tonoCuello === 'verde' ? { color: '#75E0A7' } : undefined}
          >
            {cuello ? `Cuello de botella · ${NOMBRE_ETAPA[cuello]}` : 'Sin cuello de botella'}
          </span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>
            {dCuello
              ? fraseCuello(dCuello, i)
              : 'Cumple las metas de las cuatro etapas en el periodo'}
          </span>
          {dCuello && (
            <span style={{ fontSize: 13, color: '#B4BCCC' }}>
              {dCuello.etiqueta}: {dCuello.valor} ({dCuello.meta.toLowerCase()}) · subcuenta{' '}
              {describir(dCuello.clave, s, null).valor}
            </span>
          )}
        </div>
      </section>

      <section
        aria-label="Etapas"
        className="rejilla"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))' }}
      >
        {ETAPAS_ORDEN.map((e) => {
          const estado = ev.etapas[e];
          const x = destacadoEtapa(e, ev.estados, i);
          return (
            <div key={e} className={`etapa-clara${estado === 'rojo' ? ' etapa-clara--rojo' : ''}`}>
              <div className="fila-cabecera">
                <span className="etapa-clara__nombre">{NOMBRE_ETAPA[e]}</span>
                <Pildora tono={tonoDe(estado)}>{textoEstado(estado)}</Pildora>
              </div>
              <span className="etapa-clara__valor">{x.valor}</span>
              <span style={{ fontSize: 13, color: '#5B6475' }}>{x.etiqueta}</span>
              <div
                className="progreso progreso--fino"
                role="img"
                aria-label={x.avance === null ? 'Sin dato' : `${Math.round(x.avance)} % de la meta`}
              >
                <div
                  className={estado === 'rojo' ? 'progreso--rojo' : undefined}
                  style={{ width: `${x.avance ?? 0}%` }}
                />
              </div>
              <span style={{ fontSize: 12, color: '#5B6475' }}>
                {x.meta} · subcuenta {describir(x.clave, s, null).valor}
              </span>
              {e === 'negociacion' && <BotonEjemplos />}
            </div>
          );
        })}
      </section>

      <RanuraEjemplos />

      <div
        className="rejilla"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(340px, 100%), 1fr))' }}
      >
        <section aria-label="Indicadores del asesor" className="seccion">
          <h2
            className="seccion__titulo seccion__titulo--chico"
            style={{ padding: '20px 24px 12px' }}
          >
            Sus 8 indicadores
          </h2>
          <div className="tabla-caja">
            <table className="tabla" style={{ minWidth: 460 }}>
              <thead>
                <tr>
                  <th scope="col">Indicador</th>
                  <th scope="col">{nombre}</th>
                  <th scope="col">Meta</th>
                  <th scope="col">Subcuenta</th>
                </tr>
              </thead>
              <tbody>
                {tabla.map((r) => {
                  const estado = r.clave ? ev.estados[r.clave] : null;
                  const color = r.clave && estado ? COLORES[tonoDe(estado)] : COLORES.azul;
                  const etiqueta = (
                    <>
                      <span className="punto" style={{ background: color }} aria-hidden="true" />
                      {r.etiqueta}
                      <span className="oculto">
                        ({r.clave ? textoEstado(estado) : 'referencia'})
                      </span>
                    </>
                  );
                  return (
                    <tr key={r.etiqueta}>
                      <td>
                        {r.esCalidad ? (
                          <BotonEjemplos variante="fila">{etiqueta}</BotonEjemplos>
                        ) : (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {etiqueta}
                          </span>
                        )}
                      </td>
                      <td style={{ fontWeight: 600 }}>{r.valor}</td>
                      <td style={{ color: '#5B6475' }}>{r.meta}</td>
                      <td style={{ color: '#5B6475' }}>{r.prom}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="seccion__nota" style={{ padding: '0 24px 16px', margin: 0 }}>
            En los conteos, la columna Subcuenta es el promedio por asesor con leads en el periodo.
          </p>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section aria-label="Intentos de contacto" className="seccion seccion--relleno">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 className="seccion__titulo seccion__titulo--chico">
                Intentos de contacto por lead
              </h2>
              <span className="seccion__nota">
                Promedio {numero(i.intentosPorLead, 1)} · meta 2 o más
              </span>
            </div>
            <GraficoBarras
              bajas
              etiqueta="Distribución de intentos de contacto por lead"
              datos={[
                { etiqueta: '0 intentos', valor: i.intentosDistribucion[0], tono: 'naranja' },
                { etiqueta: '1 intento', valor: i.intentosDistribucion[1], tono: 'naranja' },
                { etiqueta: '2 intentos', valor: i.intentosDistribucion[2] },
                { etiqueta: '3 o más', valor: i.intentosDistribucion[3] },
              ]}
            />
          </section>

          <section
            aria-label="Tipo de mensajes"
            className="seccion seccion--relleno"
            style={{ gap: 12 }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <h2 className="seccion__titulo seccion__titulo--chico">Qué tipo de mensajes envía</h2>
              <span className="seccion__nota">
                {d.calidad
                  ? `Calidad ${calidad(i.calidad)} · último análisis: ${mesAnio(d.calidad.periodoDesde)}`
                  : 'Aún no hay un análisis de calidad terminado.'}
              </span>
            </div>
            {totalTipos > 0 && (
              <>
                <div className="apilada" role="img" aria-label="Distribución por tipo de mensaje">
                  {tipos.map(([k, v], n) => (
                    <div
                      key={k}
                      style={{
                        flex: `${v} 1 0`,
                        background: COLORES_TIPO[n % COLORES_TIPO.length],
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
                  {tipos.map(([k, v], n) => (
                    <span
                      key={k}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        fontSize: 12,
                        color: '#3A4252',
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: COLORES_TIPO[n % COLORES_TIPO.length],
                        }}
                        aria-hidden="true"
                      />
                      {NOMBRES_CATEGORIA[k as CategoriaCalidad] ?? k}{' '}
                      {porcentaje((v / totalTipos) * 100, 0)}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>
      </div>
    </ProveedorEjemplos>
  );
}
