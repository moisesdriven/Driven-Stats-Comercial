import Link from 'next/link';
import { sql } from 'drizzle-orm';
import { fechaLocal, partesLocales } from '@driven/core';
import { Ausencias, type AusenciaUI } from '@/componentes/panel/Ausencias';
import { EditorHorario } from '@/componentes/panel/EditorHorario';
import { horasSemana, type TramoUI } from '@/lib/horas';
import { SelectorSubcuenta } from '@/componentes/panel/Filtros';
import { fechaLarga, iniciales, nombreCorto, numero } from '@/lib/formato';
import { obtenerDb } from '@/servidor/db';
import { obtenerHorarios } from '@/servidor/horarios';
import { enPagina, exigirSubcuentaPagina, requerirModuloPagina } from '@/servidor/pagina';

export const metadata = { title: 'Horarios por asesor · Driven Comercial' };

interface FilaHorario {
  user_id: string | null;
  dia_semana: number;
  inicio: string;
  fin: string;
  vigente_desde: string;
  vigente_hasta: string | null;
}
interface FilaAusencia {
  id: number;
  user_id: string | null;
  inicio: Date | string;
  fin: Date | string;
  tipo: AusenciaUI['tipo'];
  motivo: string | null;
}

const ZONAS: Record<string, string> = {
  'America/Lima': 'Lima',
  'America/Bogota': 'Bogotá',
  'America/Mexico_City': 'Ciudad de México',
  'America/Santiago': 'Santiago',
  'America/Guayaquil': 'Guayaquil',
};

/** Tramos vigentes hoy (la vigencia más reciente ya iniciada) y el próximo cambio programado, si hay. */
function vigencia(filas: FilaHorario[], hoy: string) {
  const desdes = [...new Set(filas.map((f) => f.vigente_desde))].sort();
  const actual = desdes.filter((d) => d <= hoy).pop() ?? null;
  const futuro = desdes.find((d) => d > hoy) ?? null;
  const tramos = (d: string | null): TramoUI[] =>
    d
      ? filas
          .filter((f) => f.vigente_desde === d)
          .map((f) => ({ diaSemana: f.dia_semana, inicio: f.inicio, fin: f.fin }))
      : [];
  return {
    desde: actual,
    tramos: tramos(actual),
    futuro: futuro ? { desde: futuro, tramos: tramos(futuro) } : null,
  };
}

function textoAusencia(a: FilaAusencia, zona: string): string {
  const i = partesLocales(new Date(a.inicio), zona);
  const f = partesLocales(new Date(new Date(a.fin).getTime() - 1), zona);
  const fi = fechaLocal(new Date(a.inicio), zona);
  const ff = fechaLocal(new Date(new Date(a.fin).getTime() - 1), zona);
  const diaCompleto =
    i.hora === 0 &&
    i.minuto === 0 &&
    partesLocales(new Date(a.fin), zona).hora === 0 &&
    partesLocales(new Date(a.fin), zona).minuto === 0;
  const hhmm = (p: { hora: number; minuto: number }) =>
    `${p.hora}:${String(p.minuto).padStart(2, '0')}`;
  if (!diaCompleto) {
    const fin = partesLocales(new Date(a.fin), zona);
    return fi === ff
      ? `${fechaLarga(fi)} · ${hhmm(i)} a ${hhmm(fin)}`
      : `Del ${fechaLarga(fi)} ${hhmm(i)} al ${fechaLarga(ff)} ${hhmm(f)}`;
  }
  if (fi === ff) return fechaLarga(fi);
  const [ai, mi] = fi.split('-');
  const [af, mf] = ff.split('-');
  const largaF = fechaLarga(ff);
  if (ai === af && mi === mf)
    return `Del ${Number(fi.slice(8))} al ${largaF.replace(/ de \d{4}$/, '')}`;
  return `Del ${fechaLarga(fi).replace(/ de \d{4}$/, ai === af ? '' : '$&')} al ${largaF}`;
}

export default async function Horarios({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ctx } = await requerirModuloPagina('horarios');
  const sp = await searchParams;
  const db = obtenerDb();
  const subs = ctx.subcuentas.length
    ? (
        await db.execute<{ location_id: string; nombre: string; zona_horaria: string }>(
          sql`select location_id, nombre, zona_horaria from comercial.subcuentas where activa and location_id in ${ctx.subcuentas} order by nombre`,
        )
      ).rows
    : [];
  if (!subs.length) {
    return (
      <>
        <h1 className="titulo">Horarios por asesor</h1>
        <p className="vacio">No tienes subcuentas asignadas.</p>
      </>
    );
  }
  const pedida = typeof sp.subcuenta === 'string' ? sp.subcuenta : subs[0]!.location_id;
  exigirSubcuentaPagina(ctx, pedida);
  const sub = subs.find((s) => s.location_id === pedida) ?? subs[0]!;
  const id = sub.location_id;
  const zona = sub.zona_horaria;
  const hoy = fechaLocal(new Date(), zona);
  const { horarios, ausencias } = await enPagina(obtenerHorarios(db, ctx, id));
  const filas = horarios as unknown as FilaHorario[];
  const esAsesor = ctx.rol === 'asesor';
  const asesores = (
    await db.execute<{ user_id: string; nombre: string }>(sql`
      select a.user_id, a.nombre from comercial.asesor_subcuenta s join comercial.asesores a on a.user_id = s.user_id
      where s.location_id = ${id} and s.activo ${esAsesor ? sql`and a.user_id = ${ctx.userIdGhl ?? '-'}` : sql``}
      order by a.nombre`)
  ).rows.map((a) => ({ userId: a.user_id, nombre: nombreCorto(a.nombre) }));

  const general = vigencia(
    filas.filter((f) => f.user_id === null),
    hoy,
  );
  const items = [
    ...(esAsesor
      ? []
      : [
          {
            clave: 'general',
            userId: null as string | null,
            nombre: 'Horario general',
            ini: 'HG',
            propio: true,
            v: general,
          },
        ]),
    ...asesores.map((a) => {
      const propias = filas.filter((f) => f.user_id === a.userId);
      return {
        clave: a.userId,
        userId: a.userId as string | null,
        nombre: a.nombre,
        ini: iniciales(a.nombre),
        propio: propias.length > 0,
        v: propias.length ? vigencia(propias, hoy) : general,
      };
    }),
  ];
  const elegido = items.find((x) => x.clave === sp.asesor) ?? items[0];
  const puedeEditar = ctx.modulos.horarios === 'editar';
  const nombres = new Map(asesores.map((a) => [a.userId, a.nombre]));
  const lista: AusenciaUI[] = (ausencias as unknown as FilaAusencia[]).map((a) => ({
    id: Number(a.id),
    tipo: a.tipo,
    quien: a.user_id
      ? (nombres.get(a.user_id) ?? 'Asesor')
      : `Toda la subcuenta${a.motivo ? ` · ${a.motivo}` : ''}`,
    fecha: textoAusencia(a, zona),
    editable: !esAsesor || a.user_id === ctx.userIdGhl,
  }));
  const zonaTexto = ZONAS[zona] ?? zona;

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__textos">
          <h1 className="titulo">Horarios por asesor</h1>
          <p className="subtitulo">
            Los tiempos de respuesta, espera y seguimiento solo cuentan dentro de estos tramos.
          </p>
        </div>
        {subs.length > 1 && (
          <div className="filtros">
            <SelectorSubcuenta
              actual={id}
              opciones={subs.map((s) => ({ id: s.location_id, nombre: s.nombre }))}
              plantilla="/horarios?subcuenta={id}"
              conservarPeriodo={false}
            />
          </div>
        )}
      </div>

      {!elegido ? (
        <p className="vacio">Esta subcuenta aún no tiene asesores cargados.</p>
      ) : (
        <div
          className="rejilla"
          style={{
            gridTemplateColumns: 'minmax(220px, 286px) minmax(0, 1fr)',
            alignItems: 'start',
          }}
        >
          <nav aria-label="Asesores" className="lista-lateral">
            <span className="kpi__etiqueta" style={{ padding: '8px 10px' }}>
              Asesores
            </span>
            {items.map((x) => (
              <Link
                key={x.clave}
                href={`/horarios?subcuenta=${id}&asesor=${x.clave}`}
                className="lista-lateral__item"
                aria-pressed={x.clave === elegido.clave}
                aria-current={x.clave === elegido.clave ? 'page' : undefined}
              >
                <span className="avatar-chico" aria-hidden="true">
                  {x.ini}
                </span>
                <span style={{ display: 'flex', flexDirection: 'column' }}>
                  <span style={{ fontWeight: 600, fontSize: 14 }}>{x.nombre}</span>
                  <span className="lista-lateral__sub">
                    {numero(horasSemana(x.v.tramos), 1)} h por semana
                    {x.userId && !x.propio ? ' · usa el general' : ''}
                  </span>
                </span>
              </Link>
            ))}
          </nav>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
            <section aria-label="Horario semanal" className="seccion seccion--relleno">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <h2 className="seccion__titulo">
                  {elegido.nombre} · {numero(horasSemana(elegido.v.tramos), 1)} h por semana
                </h2>
                <span className="seccion__nota">
                  {elegido.userId && !elegido.propio
                    ? `No tiene horario propio: usa el horario general · zona horaria de ${zonaTexto}`
                    : elegido.v.desde
                      ? `Vigente desde el ${fechaLarga(elegido.v.desde)} · zona horaria de ${zonaTexto}`
                      : `Sin horario cargado · zona horaria de ${zonaTexto}`}
                </span>
                {elegido.v.futuro && elegido.propio && (
                  <span className="aviso aviso--info">
                    Cambio programado desde el {fechaLarga(elegido.v.futuro.desde)}:{' '}
                    {numero(horasSemana(elegido.v.futuro.tramos), 1)} h por semana.
                  </span>
                )}
              </div>
              <EditorHorario
                key={`${id}-${elegido.clave}-${elegido.v.desde}`}
                locationId={id}
                userId={elegido.userId}
                tramos={elegido.v.tramos}
                hoy={hoy}
                puedeEditar={puedeEditar && (!esAsesor || elegido.userId === ctx.userIdGhl)}
                destinos={esAsesor ? [] : asesores.filter((a) => a.userId !== elegido.userId)}
              />
            </section>

            <Ausencias
              locationId={id}
              zona={zona}
              hoy={hoy}
              lista={lista}
              asesores={asesores}
              puedeEditar={puedeEditar}
              soloPropias={esAsesor}
            />
          </div>
        </div>
      )}
    </>
  );
}
