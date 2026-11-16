import Link from 'next/link';
import { Pildora } from '@/componentes/panel/Bloques';
import {
  AltaSubcuenta,
  LanzarAnalisis,
  MapaEtapas,
  ZonaSubcuenta,
} from '@/componentes/panel/Configuracion';
import { nombreZona, ZONAS } from '@/lib/zonas';
import { SelectorSubcuenta } from '@/componentes/panel/Filtros';
import { fechaLarga, haceCuanto, numero } from '@/lib/formato';
import { NOMBRE_ESTANDAR } from '@/lib/semaforo';
import { historialCalidad } from '@/servidor/calidad';
import { cargasRecientes, estadoSubcuentas, etapasDeSubcuenta } from '@/servidor/configuracion';
import { obtenerDb } from '@/servidor/db';
import { enPagina, exigirSubcuentaPagina, requerirModuloPagina } from '@/servidor/pagina';

export const metadata = { title: 'Configuración · Driven Comercial' };

const SECCIONES = [
  { clave: 'subcuentas', nombre: 'Subcuentas y tokens' },
  { clave: 'etapas', nombre: 'Mapa de etapas' },
  { clave: 'cargas', nombre: 'Estado de cargas' },
  { clave: 'calidad', nombre: 'Calidad de mensajes' },
] as const;

const RECURSO: Record<string, string> = {
  mensajes: 'Mensajes',
  historico: 'Carga histórica',
  oportunidades: 'Oportunidades',
  contactos: 'Contactos',
  tareas: 'Tareas',
  usuarios: 'Asesores',
};
const TIPO_CARGA: Record<string, string> = {
  incremental: 'Incremental (cada 15 min)',
  nocturno: 'Nocturna',
  historico: 'Histórica',
};
const ESTADO_ANALISIS: Record<
  string,
  { texto: string; tono: 'verde' | 'amarillo' | 'rojo' | 'gris' | 'azul' }
> = {
  solicitado: { texto: 'Solicitado', tono: 'azul' },
  preparando: { texto: 'Preparando', tono: 'azul' },
  enviado: { texto: 'En proceso', tono: 'amarillo' },
  terminado: { texto: 'Terminado', tono: 'verde' },
  fallido: { texto: 'Fallido', tono: 'rojo' },
  detenido_por_tope: { texto: 'Detenido por tope', tono: 'rojo' },
  sin_universo: { texto: 'Sin conversaciones', tono: 'gris' },
};
const usd = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : `US$ ${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
const duracion = (ini: Date, fin: Date | null) => {
  if (!fin) return 'en curso';
  const s = Math.round((new Date(fin).getTime() - new Date(ini).getTime()) / 1000);
  return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${numero(s / 3600, 1)} h`;
};

export default async function Configuracion({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirModuloPagina('configuracion');
  const sp = await searchParams;
  const seccion = SECCIONES.find((s) => s.clave === sp.seccion)?.clave ?? 'subcuentas';
  const db = obtenerDb();
  const puedeEditar = ctx.modulos.configuracion === 'editar';
  const subs = (await enPagina(estadoSubcuentas(db, ctx))).filter((s) =>
    ctx.subcuentas.includes(s.locationId),
  );
  const id = typeof sp.subcuenta === 'string' ? sp.subcuenta : subs[0]?.locationId;
  if (id) exigirSubcuentaPagina(ctx, id);
  const opciones = subs.map((s) => ({ id: s.locationId, nombre: s.nombre }));
  const selector = (sec: string) =>
    subs.length > 1 && id ? (
      <div className="filtros">
        <SelectorSubcuenta
          actual={id}
          opciones={opciones}
          plantilla={`/configuracion?seccion=${sec}&subcuenta={id}`}
          conservarPeriodo={false}
        />
      </div>
    ) : null;

  let contenido: React.ReactNode = null;
  if (seccion === 'subcuentas') {
    contenido = (
      <>
        <section aria-label="Subcuentas" className="seccion">
          <div className="tabla-caja">
            <table className="tabla" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th scope="col">Subcuenta</th>
                  <th scope="col">Zona horaria</th>
                  <th scope="col">Token</th>
                  <th scope="col">Última carga</th>
                  <th scope="col">Etapas de calidad</th>
                </tr>
              </thead>
              <tbody>
                {subs.map((s) => {
                  const ultima = [...s.ultimasCargas].sort(
                    (a, b) => new Date(b.inicio).getTime() - new Date(a.inicio).getTime(),
                  )[0];
                  return (
                    <tr key={s.locationId}>
                      <td>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>
                            {s.nombre}
                            {!s.activa && ' (inactiva)'}
                          </span>
                          <span
                            style={{
                              fontSize: 12,
                              color: '#5B6475',
                              fontFamily: 'ui-monospace, monospace',
                            }}
                          >
                            {s.locationId}
                          </span>
                        </span>
                      </td>
                      <td>
                        {puedeEditar ? (
                          <ZonaSubcuenta
                            locationId={s.locationId}
                            nombre={s.nombre}
                            zona={s.zonaHoraria}
                            zonas={ZONAS}
                          />
                        ) : (
                          nombreZona(s.zonaHoraria)
                        )}
                      </td>
                      <td>
                        {s.token ? (
                          <Pildora tono="verde">
                            Verificado {haceCuanto(s.token.verificadoEn)}
                          </Pildora>
                        ) : (
                          <Pildora tono="rojo">Sin token</Pildora>
                        )}
                      </td>
                      <td>
                        {ultima ? (
                          <Pildora
                            tono={
                              ultima.estado === 'ok'
                                ? 'verde'
                                : ultima.estado === 'error'
                                  ? 'rojo'
                                  : 'azul'
                            }
                          >
                            {ultima.estado === 'ok'
                              ? 'Correcta'
                              : ultima.estado === 'error'
                                ? 'Con error'
                                : 'En curso'}{' '}
                            · {haceCuanto(ultima.fin ?? ultima.inicio)}
                          </Pildora>
                        ) : (
                          'Nunca'
                        )}
                      </td>
                      <td>
                        {s.etapasCalidad?.length === 3 ? (
                          '3 elegidas'
                        ) : (
                          <Pildora tono="amarillo">Faltan</Pildora>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {subs.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: '#5B6475' }}>
                      Aún no hay subcuentas dadas de alta.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        {puedeEditar && <AltaSubcuenta />}
      </>
    );
  } else if (seccion === 'etapas' && id) {
    const { etapas } = await enPagina(etapasDeSubcuenta(db, ctx, id));
    const pipelines = [...new Set(etapas.map((e) => e.pipelineId))];
    contenido = (
      <MapaEtapas
        key={id}
        locationId={id}
        puedeEditar={puedeEditar}
        etapas={[...etapas]
          .sort(
            (a, b) =>
              a.pipelineId.localeCompare(b.pipelineId) ||
              a.creadoEn.getTime() - b.creadoEn.getTime(),
          )
          .map((e) => ({
            stageId: e.stageId,
            nombre: e.nombreOriginal,
            pipeline:
              pipelines.length > 1 ? `Pipeline ${pipelines.indexOf(e.pipelineId) + 1}` : null,
            estandar: e.etapaEstandar && NOMBRE_ESTANDAR[e.etapaEstandar] ? e.etapaEstandar : null,
          }))}
      />
    );
  } else if (seccion === 'cargas' && id) {
    const cargas = await enPagina(cargasRecientes(db, ctx, id));
    const marcas = subs.find((s) => s.locationId === id)?.marcas ?? [];
    contenido = (
      <>
        {marcas.length > 0 && (
          <section aria-label="Datos al día" className="rejilla rejilla--kpis-chicos">
            {marcas.map((m) => (
              <div key={m.recurso} className="kpi kpi--chico">
                <span className="kpi__etiqueta">{RECURSO[m.recurso] ?? m.recurso}</span>
                <span style={{ fontSize: 15, fontWeight: 600 }}>
                  {m.marcaAgua
                    ? `Al día hasta ${haceCuanto(m.marcaAgua).toLowerCase()}`
                    : 'Sin datos'}
                </span>
                {m.ultimoError && (
                  <span style={{ fontSize: 12, color: '#B42318' }}>{m.ultimoError}</span>
                )}
              </div>
            ))}
          </section>
        )}
        <section aria-label="Cargas recientes" className="seccion">
          <h2
            className="seccion__titulo seccion__titulo--chico"
            style={{ padding: '20px 24px 12px' }}
          >
            Últimas cargas
          </h2>
          <div className="tabla-caja">
            <table className="tabla" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th scope="col">Tipo</th>
                  <th scope="col">Inicio</th>
                  <th scope="col">Duración</th>
                  <th scope="col">Llamadas a GHL</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {cargas.map((c) => (
                  <tr key={c.id}>
                    <td>
                      {TIPO_CARGA[c.tipo] ?? c.tipo}
                      {c.modo === 'sombra' && (
                        <span style={{ fontSize: 12, color: '#5B6475' }}> · modo sombra</span>
                      )}
                    </td>
                    <td>{haceCuanto(c.inicio)}</td>
                    <td>{duracion(c.inicio, c.fin)}</td>
                    <td>{numero(c.llamadas)}</td>
                    <td>
                      <Pildora
                        tono={c.estado === 'ok' ? 'verde' : c.estado === 'error' ? 'rojo' : 'azul'}
                      >
                        {c.estado === 'ok'
                          ? 'Correcta'
                          : c.estado === 'error'
                            ? 'Con error'
                            : 'En curso'}
                      </Pildora>
                      {c.error && (
                        <span
                          style={{ display: 'block', fontSize: 12, color: '#B42318', marginTop: 4 }}
                        >
                          {c.error.slice(0, 200)}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {cargas.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: '#5B6475' }}>
                      Aún no hay cargas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  } else if (seccion === 'calidad') {
    const h = await enPagina(historialCalidad(db, ctx));
    const nombres = new Map(subs.map((s) => [s.locationId, s.nombre]));
    const pct = h.topeMensualUsd ? Math.min(100, (h.gastoDelMesUsd / h.topeMensualUsd) * 100) : 0;
    const hoy = new Date();
    const finMesPasado = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 0));
    const iniMesPasado = new Date(
      Date.UTC(finMesPasado.getUTCFullYear(), finMesPasado.getUTCMonth(), 1),
    );
    contenido = (
      <>
        <section aria-label="Gasto del mes" className="seccion seccion--relleno">
          <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
            <h2 className="seccion__titulo seccion__titulo--chico">Gasto del mes en análisis</h2>
            <span style={{ fontFamily: 'var(--titulos)', fontSize: 22, fontWeight: 700 }}>
              {usd(h.gastoDelMesUsd)}{' '}
              <span style={{ fontSize: 14, color: '#5B6475', fontWeight: 500 }}>
                de {usd(h.topeMensualUsd)}
              </span>
            </span>
          </div>
          <div className="progreso" role="img" aria-label={`${Math.round(pct)} % del tope mensual`}>
            <div
              className={pct >= 90 ? 'progreso--rojo' : undefined}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="seccion__nota">
            Si un análisis va a superar el tope, se detiene antes de enviarse. El tope se cambia en
            la configuración del servidor.
          </span>
        </section>
        {ctx.rol === 'admin' && (
          <LanzarAnalisis
            subcuentas={opciones}
            desdeSugerido={iniMesPasado.toISOString().slice(0, 10)}
            hastaSugerido={finMesPasado.toISOString().slice(0, 10)}
            conTotp={ctx.totpActivo}
          />
        )}
        <section aria-label="Historial de análisis" className="seccion">
          <h2
            className="seccion__titulo seccion__titulo--chico"
            style={{ padding: '20px 24px 12px' }}
          >
            Historial de análisis
          </h2>
          <div className="tabla-caja">
            <table className="tabla" style={{ minWidth: 820 }}>
              <thead>
                <tr>
                  <th scope="col">Subcuenta</th>
                  <th scope="col">Periodo</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Muestra</th>
                  <th scope="col">Mensajes calificados</th>
                  <th scope="col">Costo</th>
                  <th scope="col">Estado</th>
                </tr>
              </thead>
              <tbody>
                {h.analisis.map((a) => {
                  const e = ESTADO_ANALISIS[a.estado] ?? { texto: a.estado, tono: 'gris' as const };
                  return (
                    <tr key={a.id}>
                      <td style={{ fontWeight: 600 }}>
                        {nombres.get(a.locationId) ?? a.locationId}
                      </td>
                      <td>
                        {fechaLarga(a.periodoDesde)} al {fechaLarga(a.periodoHasta)}
                        <span style={{ display: 'block', fontSize: 12, color: '#5B6475' }}>
                          Lanzado {haceCuanto(a.creadoEn).toLowerCase()}
                        </span>
                      </td>
                      <td>{a.tipo === 'manual' ? 'Manual' : 'Mensual'}</td>
                      <td>{numero(a.conversacionesMuestra)}</td>
                      <td>{numero(a.mensajesCalificados)}</td>
                      <td>
                        {usd(a.costoReal ?? a.costoEstimado)}
                        <span style={{ display: 'block', fontSize: 12, color: '#5B6475' }}>
                          {a.costoReal !== null ? 'real' : 'estimado'}
                        </span>
                      </td>
                      <td>
                        <Pildora tono={e.tono}>{e.texto}</Pildora>
                        {a.error && (
                          <span
                            style={{
                              display: 'block',
                              fontSize: 12,
                              color: '#B42318',
                              marginTop: 4,
                            }}
                          >
                            {a.error.slice(0, 160)}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {h.analisis.length === 0 && (
                  <tr>
                    <td colSpan={7} style={{ color: '#5B6475' }}>
                      Aún no se ha ejecutado ningún análisis.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  } else {
    contenido = <p className="vacio">Primero da de alta una subcuenta.</p>;
  }

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__textos">
          <h1 className="titulo">Configuración</h1>
          <p className="subtitulo">
            Subcuentas, tokens de solo lectura, mapa de etapas, cargas y análisis de calidad.
          </p>
        </div>
        {(seccion === 'etapas' || seccion === 'cargas') && selector(seccion)}
      </div>
      <nav
        aria-label="Secciones de configuración"
        className="pestanas"
        style={{ alignSelf: 'flex-start' }}
      >
        {SECCIONES.map((s) => (
          <Link
            key={s.clave}
            className="pestana"
            href={`/configuracion?seccion=${s.clave}${id && s.clave !== 'subcuentas' && s.clave !== 'calidad' ? `&subcuenta=${id}` : ''}`}
            aria-current={s.clave === seccion ? 'page' : undefined}
          >
            {s.nombre}
          </Link>
        ))}
      </nav>
      {contenido}
    </>
  );
}
