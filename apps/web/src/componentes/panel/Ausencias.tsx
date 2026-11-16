'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { instanteLocal } from '@driven/core';
import { IconoCerrar } from './Iconos';

export interface AusenciaUI {
  id: number;
  tipo: 'feriado' | 'vacaciones' | 'permiso';
  quien: string;
  fecha: string;
  editable: boolean;
}

const CHIP = {
  feriado: { texto: 'Feriado', estilo: { background: '#E8EEFF', color: '#1F5BFF' } },
  vacaciones: { texto: 'Vacaciones', estilo: { background: '#FEF3E2', color: '#93370D' } },
  permiso: { texto: 'Permiso', estilo: { background: '#F0F3F9', color: '#3A4252' } },
} as const;

/** "2026-11-20" + "09:00" en la zona de la subcuenta → ISO con desfase. */
function iso(fecha: string, hora: string, zona: string) {
  const [a, m, d] = fecha.split('-').map(Number) as [number, number, number];
  const [h, mi] = hora.split(':').map(Number) as [number, number];
  return instanteLocal(a, m, d, h, mi, zona).toISOString();
}
const diaSiguiente = (f: string) =>
  new Date(Date.parse(`${f}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

interface Props {
  locationId: string;
  zona: string;
  hoy: string;
  lista: AusenciaUI[];
  asesores: { userId: string; nombre: string }[];
  puedeEditar: boolean;
  /** El asesor solo registra ausencias propias (no feriados). */
  soloPropias: boolean;
}

export function Ausencias({
  locationId,
  zona,
  hoy,
  lista,
  asesores,
  puedeEditar,
  soloPropias,
}: Props) {
  const router = useRouter();
  const [abierto, setAbierto] = useState(false);
  const [tipo, setTipo] = useState<AusenciaUI['tipo']>(soloPropias ? 'vacaciones' : 'feriado');
  const [quien, setQuien] = useState(asesores[0]?.userId ?? '');
  const [desde, setDesde] = useState(hoy);
  const [hasta, setHasta] = useState(hoy);
  const [horaIni, setHoraIni] = useState('09:00');
  const [horaFin, setHoraFin] = useState('13:00');
  const [motivo, setMotivo] = useState('');
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async () => {
    setEnviando(true);
    setMensaje(null);
    const cuerpo = {
      userId: tipo === 'feriado' ? null : quien,
      tipo,
      inicio: tipo === 'permiso' ? iso(desde, horaIni, zona) : iso(desde, '00:00', zona),
      fin: tipo === 'permiso' ? iso(desde, horaFin, zona) : iso(diaSiguiente(hasta), '00:00', zona),
      ...(motivo.trim() ? { motivo: motivo.trim() } : {}),
    };
    const r = await fetch(`/api/subcuentas/${locationId}/ausencias`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    setEnviando(false);
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))) as { error?: string };
      setMensaje({ tipo: 'error', texto: e.error ?? 'No se pudo registrar la ausencia.' });
      return;
    }
    setMensaje({ tipo: 'ok', texto: 'Ausencia registrada. Ese tiempo no cuenta como laboral.' });
    setAbierto(false);
    setMotivo('');
    router.refresh();
  };

  const eliminar = async (a: AusenciaUI) => {
    if (!confirm(`¿Eliminar ${CHIP[a.tipo].texto.toLowerCase()} de ${a.quien} (${a.fecha})?`))
      return;
    const r = await fetch(`/api/subcuentas/${locationId}/ausencias/${a.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const e = (await r.json().catch(() => ({}))) as { error?: string };
      setMensaje({ tipo: 'error', texto: e.error ?? 'No se pudo eliminar.' });
      return;
    }
    router.refresh();
  };

  return (
    <section aria-label="Ausencias y feriados" className="seccion seccion--relleno">
      <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
        <h2 className="seccion__titulo seccion__titulo--chico">Ausencias y feriados</h2>
        {puedeEditar && !abierto && (
          <button
            type="button"
            className="boton-sec boton-sec--azul"
            onClick={() => setAbierto(true)}
          >
            Registrar ausencia
          </button>
        )}
      </div>
      {mensaje && (
        <p className={`aviso aviso--${mensaje.tipo}`} role="status">
          {mensaje.texto}
        </p>
      )}
      {abierto && (
        <form
          className="formulario-linea"
          onSubmit={(e) => {
            e.preventDefault();
            void enviar();
          }}
        >
          <label className="campo">
            <span>Tipo</span>
            <select
              className="control"
              value={tipo}
              onChange={(e) => setTipo(e.target.value as AusenciaUI['tipo'])}
            >
              {!soloPropias && <option value="feriado">Feriado (toda la subcuenta)</option>}
              <option value="vacaciones">Vacaciones</option>
              <option value="permiso">Permiso por horas</option>
            </select>
          </label>
          {tipo !== 'feriado' && (
            <label className="campo">
              <span>Asesor</span>
              <select className="control" value={quien} onChange={(e) => setQuien(e.target.value)}>
                {asesores.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="campo">
            <span>{tipo === 'permiso' ? 'Fecha' : 'Desde'}</span>
            <input
              className="control"
              type="date"
              required
              value={desde}
              onChange={(e) => {
                setDesde(e.target.value);
                if (hasta < e.target.value) setHasta(e.target.value);
              }}
            />
          </label>
          {tipo === 'permiso' ? (
            <>
              <label className="campo">
                <span>De</span>
                <input
                  className="control"
                  type="time"
                  step={900}
                  required
                  value={horaIni}
                  onChange={(e) => setHoraIni(e.target.value)}
                />
              </label>
              <label className="campo">
                <span>A</span>
                <input
                  className="control"
                  type="time"
                  step={900}
                  required
                  value={horaFin}
                  onChange={(e) => setHoraFin(e.target.value)}
                />
              </label>
            </>
          ) : (
            <label className="campo">
              <span>Hasta (incluido)</span>
              <input
                className="control"
                type="date"
                required
                min={desde}
                value={hasta}
                onChange={(e) => setHasta(e.target.value)}
              />
            </label>
          )}
          <label className="campo" style={{ flex: '1 1 200px' }}>
            <span>Motivo (opcional)</span>
            <input
              className="control"
              maxLength={200}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={tipo === 'feriado' ? 'Inmaculada Concepción' : ''}
            />
          </label>
          <button className="boton" disabled={enviando}>
            {enviando ? 'Guardando…' : 'Registrar'}
          </button>
          <button type="button" className="boton-sec" onClick={() => setAbierto(false)}>
            Cancelar
          </button>
        </form>
      )}
      {lista.length === 0 ? (
        <p className="vacio">No hay ausencias ni feriados registrados.</p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {lista.map((a) => (
            <li key={a.id} className="fila-ausencia">
              <span className="chip-tipo" style={CHIP[a.tipo].estilo}>
                {CHIP[a.tipo].texto}
              </span>
              <span style={{ fontSize: 14, fontWeight: 600, flex: '1 1 200px' }}>{a.quien}</span>
              <span style={{ fontSize: 13, color: '#5B6475' }}>{a.fecha}</span>
              {puedeEditar && a.editable && (
                <button
                  type="button"
                  className="boton-icono boton-icono--claro"
                  style={{ width: 36, height: 36 }}
                  aria-label={`Eliminar ${CHIP[a.tipo].texto.toLowerCase()} de ${a.quien}`}
                  onClick={() => void eliminar(a)}
                >
                  <IconoCerrar />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
