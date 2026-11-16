'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { fechaLarga } from '@/lib/formato';
import { aMinutos, type TramoUI } from '@/lib/horas';
import { IconoCerrar, IconoMas } from './Iconos';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
const aMin = aMinutos;
const hora = (h: string) => h.replace(/^0/, '');

/** Línea de tiempo semanal (solo lectura): de 7:00 a 21:00 o lo que ocupen los tramos. */
export function Semana({ tramos }: { tramos: TramoUI[] }) {
  const ini = Math.min(7, ...tramos.map((t) => Math.floor(aMin(t.inicio) / 60)));
  const fin = Math.max(21, ...tramos.map((t) => Math.ceil(aMin(t.fin) / 60)));
  const ancho = (fin - ini) * 60;
  const marcas: number[] = [];
  for (let h = ini; h <= fin; h += 2) marcas.push(h);
  return (
    <div className="tabla-caja">
      <div className="semana">
        <div className="semana__fila" aria-hidden="true">
          <span className="semana__dia" />
          <div className="semana__horas">
            {marcas.map((h) => (
              <span key={h}>{h}:00</span>
            ))}
          </div>
        </div>
        {DIAS.map((nombre, i) => {
          const delDia = tramos
            .filter((t) => t.diaSemana === i + 1)
            .sort((a, b) => a.inicio.localeCompare(b.inicio));
          return (
            <div key={nombre} className="semana__fila">
              <span className="semana__dia">{nombre}</span>
              <div
                className="semana__pista"
                role="img"
                aria-label={
                  delDia.length
                    ? `${nombre}: ${delDia.map((t) => `${hora(t.inicio)} a ${hora(t.fin)}`).join(' y ')}`
                    : `${nombre}: día libre`
                }
              >
                {delDia.length === 0 && <span className="semana__libre">Día libre</span>}
                {delDia.map((t) => (
                  <span
                    key={t.inicio}
                    className="semana__tramo"
                    style={{
                      left: `${((aMin(t.inicio) - ini * 60) / ancho) * 100}%`,
                      width: `${((aMin(t.fin) - aMin(t.inicio)) / ancho) * 100}%`,
                    }}
                  >
                    {hora(t.inicio)} a {hora(t.fin)}
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface Props {
  locationId: string;
  userId: string | null;
  tramos: TramoUI[];
  hoy: string;
  puedeEditar: boolean;
  destinos: { userId: string; nombre: string }[];
}

/** Botones y formulario para cambiar el horario. Un cambio rige desde la fecha elegida: el pasado no se recalcula. */
export function EditorHorario({ locationId, userId, tramos, hoy, puedeEditar, destinos }: Props) {
  const router = useRouter();
  const [modo, setModo] = useState<'ver' | 'editar' | 'copiar'>('ver');
  const [borrador, setBorrador] = useState<TramoUI[]>(tramos);
  const [desde, setDesde] = useState(hoy);
  const [destino, setDestino] = useState(destinos[0]?.userId ?? '');
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const ordenados = useMemo(() => [...borrador].map((t, i) => ({ ...t, i })), [borrador]);

  if (!puedeEditar) return <Semana tramos={tramos} />;

  const guardar = async (para: string | null, lista: TramoUI[]) => {
    setEnviando(true);
    setMensaje(null);
    const r = await fetch(`/api/subcuentas/${locationId}/horarios`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ userId: para, vigenteDesde: desde, tramos: lista }),
    });
    setEnviando(false);
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))) as { error?: string };
      setMensaje({ tipo: 'error', texto: e.error ?? 'No se pudo guardar el horario.' });
      return;
    }
    setMensaje({ tipo: 'ok', texto: `Horario guardado. Rige desde el ${fechaLarga(desde)}.` });
    setModo('ver');
    router.refresh();
  };

  const cambiar = (i: number, campo: keyof TramoUI, valor: string) =>
    setBorrador((b) =>
      b.map((t, j) =>
        j === i ? { ...t, [campo]: campo === 'diaSemana' ? Number(valor) : valor } : t,
      ),
    );

  const agregar = () => {
    const ultimo = borrador[borrador.length - 1];
    setBorrador((b) => [
      ...b,
      {
        diaSemana: ultimo ? Math.min(7, ultimo.diaSemana + 1) : 1,
        inicio: ultimo?.inicio ?? '09:00',
        fin: ultimo?.fin ?? '18:00',
      },
    ]);
    setModo('editar');
  };

  return (
    <>
      {modo === 'ver' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {destinos.length > 0 && tramos.length > 0 && (
            <button type="button" className="boton-sec" onClick={() => setModo('copiar')}>
              Copiar a otro asesor
            </button>
          )}
          <button
            type="button"
            className="boton-sec"
            onClick={() => {
              setBorrador(tramos);
              setModo('editar');
            }}
          >
            Editar horario
          </button>
          <button
            type="button"
            className="boton"
            onClick={() => {
              setBorrador(tramos);
              agregar();
            }}
          >
            <IconoMas /> Agregar tramo
          </button>
        </div>
      )}
      {mensaje && (
        <p className={`aviso aviso--${mensaje.tipo}`} role="status">
          {mensaje.texto}
        </p>
      )}

      {modo === 'copiar' && (
        <form
          className="formulario-linea"
          onSubmit={(e) => {
            e.preventDefault();
            void guardar(destino, tramos);
          }}
        >
          <label className="campo">
            <span>Copiar este horario a</span>
            <select
              className="control"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
            >
              {destinos.map((d) => (
                <option key={d.userId} value={d.userId}>
                  {d.nombre}
                </option>
              ))}
            </select>
          </label>
          <label className="campo">
            <span>Rige desde</span>
            <input
              className="control"
              type="date"
              value={desde}
              min={hoy}
              required
              onChange={(e) => setDesde(e.target.value)}
            />
          </label>
          <button className="boton" disabled={enviando}>
            Copiar
          </button>
          <button type="button" className="boton-sec" onClick={() => setModo('ver')}>
            Cancelar
          </button>
        </form>
      )}

      {modo === 'editar' && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void guardar(userId, borrador);
          }}
          style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ordenados.map((t) => (
              <div key={t.i} className="formulario-linea">
                <label className="campo">
                  <span className="oculto">Día del tramo {t.i + 1}</span>
                  <select
                    className="control"
                    value={t.diaSemana}
                    onChange={(e) => cambiar(t.i, 'diaSemana', e.target.value)}
                  >
                    {DIAS.map((d, n) => (
                      <option key={d} value={n + 1}>
                        {d}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="campo">
                  <span className="oculto">Inicio del tramo {t.i + 1}</span>
                  <input
                    className="control"
                    type="time"
                    step={900}
                    required
                    value={t.inicio}
                    onChange={(e) => cambiar(t.i, 'inicio', e.target.value)}
                  />
                </label>
                <span aria-hidden="true" style={{ alignSelf: 'center' }}>
                  a
                </span>
                <label className="campo">
                  <span className="oculto">Fin del tramo {t.i + 1}</span>
                  <input
                    className="control"
                    type="time"
                    step={900}
                    required
                    value={t.fin}
                    onChange={(e) => cambiar(t.i, 'fin', e.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="boton-icono boton-icono--claro"
                  aria-label={`Quitar tramo ${t.i + 1}`}
                  onClick={() => setBorrador((b) => b.filter((_, j) => j !== t.i))}
                >
                  <IconoCerrar />
                </button>
              </div>
            ))}
          </div>
          <div className="formulario-linea">
            <button type="button" className="boton-sec" onClick={agregar}>
              <IconoMas /> Agregar tramo
            </button>
            <label className="campo">
              <span>Rige desde</span>
              <input
                className="control"
                type="date"
                value={desde}
                min={hoy}
                required
                onChange={(e) => setDesde(e.target.value)}
              />
            </label>
            <button className="boton" disabled={enviando}>
              {enviando ? 'Guardando…' : 'Guardar horario'}
            </button>
            <button
              type="button"
              className="boton-sec"
              onClick={() => {
                setBorrador(tramos);
                setModo('ver');
              }}
            >
              Cancelar
            </button>
          </div>
          <p className="seccion__nota" style={{ margin: 0 }}>
            Los días sin tramos quedan como libres. Los indicadores ya calculados antes de esa fecha
            no cambian.
          </p>
        </form>
      )}
      <Semana tramos={modo === 'editar' ? borrador : tramos} />
    </>
  );
}
