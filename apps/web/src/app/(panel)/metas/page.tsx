import { sql } from 'drizzle-orm';
import { metasDeSubcuenta } from '@driven/core';
import { SelectorSubcuenta } from '@/componentes/panel/Filtros';
import { FormularioMetas } from '@/componentes/panel/FormularioMetas';
import { NOMBRE_ESTANDAR } from '@/lib/semaforo';
import { etapasDeSubcuenta } from '@/servidor/configuracion';
import { obtenerDb } from '@/servidor/db';
import { obtenerMetas } from '@/servidor/metas';
import { enPagina, exigirSubcuentaPagina, requerirModuloPagina } from '@/servidor/pagina';

export const metadata = { title: 'Metas y etapas · Driven Comercial' };

export default async function MetasPagina({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirModuloPagina('metas');
  const sp = await searchParams;
  const db = obtenerDb();
  const subs = ctx.subcuentas.length
    ? (
        await db.execute<{ location_id: string; nombre: string; metas: unknown }>(
          sql`select location_id, nombre, metas from comercial.subcuentas where activa and location_id in ${ctx.subcuentas} order by nombre`,
        )
      ).rows
    : [];
  if (!subs.length) {
    return (
      <>
        <h1 className="titulo">Metas y etapas</h1>
        <p className="vacio">No tienes subcuentas asignadas.</p>
      </>
    );
  }
  const id = typeof sp.subcuenta === 'string' ? sp.subcuenta : subs[0]!.location_id;
  exigirSubcuentaPagina(ctx, id);
  const actual = subs.find((s) => s.location_id === id);
  const nombre = actual?.nombre ?? id;
  // Una subcuenta recién agregada no tiene metas propias: usa las de Driven por defecto hasta que
  // alguien las guarde. Para ajustarla rápido se pueden copiar las de otra subcuenta del usuario.
  const porDefecto = actual?.metas == null;
  const otras = subs
    .filter((s) => s.location_id !== id && s.metas != null)
    .map((s) => ({ id: s.location_id, nombre: s.nombre, metas: metasDeSubcuenta(s.metas) }));
  const [metas, { etapas, etapasCalidad }] = await enPagina(
    Promise.all([obtenerMetas(db, ctx, id), etapasDeSubcuenta(db, ctx, id)]),
  );
  const pipelines = [...new Set(etapas.map((e) => e.pipelineId))];
  const ordenadas = [...etapas].sort(
    (a, b) =>
      a.pipelineId.localeCompare(b.pipelineId) || a.creadoEn.getTime() - b.creadoEn.getTime(),
  );

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__textos">
          <h1 className="titulo">Metas y etapas · {nombre}</h1>
          <p className="subtitulo">
            Cada subcuenta tiene sus propias metas y etapas de calidad: lo que guardes aquí solo
            aplica a {nombre}. Las metas definen el semáforo de cada indicador y el cuello de
            botella del equipo.
          </p>
        </div>
        {subs.length > 1 && (
          <div className="filtros">
            <SelectorSubcuenta
              actual={id}
              opciones={subs.map((s) => ({ id: s.location_id, nombre: s.nombre }))}
              plantilla="/metas?subcuenta={id}"
              conservarPeriodo={false}
            />
          </div>
        )}
      </div>
      <FormularioMetas
        key={id}
        locationId={id}
        nombreSubcuenta={nombre}
        porDefecto={porDefecto}
        otras={otras}
        metas={metas}
        etapasCalidad={etapasCalidad}
        puedeEditar={ctx.modulos.metas === 'editar'}
        etapas={ordenadas.map((e) => ({
          stageId: e.stageId,
          nombre: e.nombreOriginal,
          pipeline: pipelines.length > 1 ? `Pipeline ${pipelines.indexOf(e.pipelineId) + 1}` : null,
          estandar: e.etapaEstandar ? (NOMBRE_ESTANDAR[e.etapaEstandar] ?? e.etapaEstandar) : null,
        }))}
      />
    </>
  );
}
