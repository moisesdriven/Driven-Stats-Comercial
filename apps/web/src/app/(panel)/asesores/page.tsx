import { redirect } from 'next/navigation';
import { FiltroPeriodo, SelectorSubcuenta } from '@/componentes/panel/Filtros';
import { TablaAsesores } from '@/componentes/panel/TablaAsesores';
import { numero, rangoFechas } from '@/lib/formato';
import { leerPeriodo, qsPeriodo } from '@/lib/periodo';
import { asesoresSubcuenta } from '@/servidor/consultas/indicadores';
import { subcuentasMenu } from '@/servidor/consultas/menu';
import { obtenerDb } from '@/servidor/db';
import { enPagina, exigirSubcuentaPagina, requerirModuloPagina } from '@/servidor/pagina';

export const metadata = { title: 'Asesores · Driven Comercial' };

/** Módulo Asesores: los asesores de cada subcuenta con sus indicadores y el enlace a su detalle. */
export default async function Asesores({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirModuloPagina('detalle_asesores');
  const sp = await searchParams;
  const db = obtenerDb();
  const subs = await subcuentasMenu(db, ctx);
  if (!subs.length) redirect('/sin-subcuentas');
  const id = typeof sp.subcuenta === 'string' ? sp.subcuenta : subs[0]!.locationId;
  exigirSubcuentaPagina(ctx, id);
  // Un asesor solo tiene su propio detalle.
  if (ctx.rol === 'asesor' && ctx.userIdGhl)
    redirect(`/subcuentas/${id}/asesores/${ctx.userIdGhl}`);
  const periodo = leerPeriodo(sp);
  const qs = qsPeriodo(periodo);
  const d = await enPagina(asesoresSubcuenta(db, ctx, id, periodo.desde, periodo.hasta));
  const asesores = [...d.asesores]
    .filter((a) => a.indicadores.leadsRecibidos || a.indicadores.ventas || a.indicadores.perdidos)
    .sort((a, b) => b.indicadores.leadsRecibidos - a.indicadores.leadsRecibidos);
  const leads = asesores.reduce((n, a) => n + a.indicadores.leadsRecibidos, 0);

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__textos">
          <h1 className="titulo">Asesores · {d.subcuenta.nombre}</h1>
          <p className="subtitulo">
            {asesores.length} {asesores.length === 1 ? 'asesor' : 'asesores'} con actividad ·{' '}
            {numero(leads)} leads · {rangoFechas(periodo.desde, periodo.hasta)}
          </p>
        </div>
        <div className="filtros">
          {subs.length > 1 && (
            <SelectorSubcuenta
              actual={id}
              opciones={subs.map((s) => ({ id: s.locationId, nombre: s.nombre }))}
              plantilla="/asesores?subcuenta={id}"
            />
          )}
          <FiltroPeriodo clave={periodo.clave} desde={periodo.desde} hasta={periodo.hasta} />
        </div>
      </div>
      <TablaAsesores
        titulo="Indicadores por asesor"
        asesores={asesores}
        corrido={d.corrido}
        enlace={(a) => `/subcuentas/${id}/asesores/${a}${qs}`}
      />
    </>
  );
}
