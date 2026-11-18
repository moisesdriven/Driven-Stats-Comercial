'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { numero } from '@/lib/formato';
import { NOMBRE_ESTANDAR } from '@/lib/semaforo';

type Mensaje = { tipo: 'ok' | 'error' | 'info'; texto: string } | null;

async function enviar(url: string, metodo: string, cuerpo: unknown) {
  const r = await fetch(url, {
    method: metodo,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = (await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  return { ok: r.ok, datos };
}

/** Alta de una subcuenta o renovación de su token. El token viaja una vez y se guarda cifrado; nunca se muestra. */
export function AltaSubcuenta() {
  const router = useRouter();
  const [locationId, setLocationId] = useState('');
  const [token, setToken] = useState('');
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form
      className="seccion seccion--relleno"
      aria-label="Agregar subcuenta o renovar token"
      onSubmit={async (e) => {
        e.preventDefault();
        setEnviando(true);
        setMensaje({
          tipo: 'info',
          texto: 'Verificando los permisos del token con GHL (solo lectura)…',
        });
        const r = await enviar('/api/configuracion/subcuentas', 'POST', { locationId, token });
        setEnviando(false);
        setToken('');
        if (!r.ok)
          return setMensaje({ tipo: 'error', texto: r.datos.error ?? 'No se pudo guardar.' });
        setMensaje({
          tipo: 'ok',
          texto: `Listo: ${String(r.datos.nombre)}. El token quedó cifrado. La carga inicial la lanza el administrador desde el servidor.`,
        });
        setLocationId('');
        router.refresh();
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 className="seccion__titulo seccion__titulo--chico">
          Agregar subcuenta o renovar token
        </h2>
        <span className="seccion__nota">
          Usa un token privado (PIT) de la subcuenta con permisos de solo lectura. Se prueba cada
          permiso antes de guardarlo.
        </span>
      </div>
      {mensaje && (
        <p className={`aviso aviso--${mensaje.tipo}`} role="status">
          {mensaje.texto}
        </p>
      )}
      <div className="formulario-linea">
        <label className="campo" style={{ flex: '1 1 220px' }}>
          <span>ID de la subcuenta (locationId)</span>
          <input
            className="control"
            required
            minLength={5}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          />
        </label>
        <label className="campo" style={{ flex: '2 1 320px' }}>
          <span>Token privado (PIT)</span>
          <input
            className="control"
            required
            type="password"
            minLength={10}
            autoComplete="new-password"
            spellCheck={false}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
        </label>
        <button className="boton" disabled={enviando}>
          {enviando ? 'Verificando…' : 'Verificar y guardar'}
        </button>
      </div>
    </form>
  );
}

interface EtapaMapa {
  stageId: string;
  nombre: string;
  pipeline: string | null;
  estandar: string | null;
}

/** Mapa de cada etapa real del pipeline a una etapa estándar (§3). */
export function MapaEtapas({
  locationId,
  etapas,
  puedeEditar,
}: {
  locationId: string;
  etapas: EtapaMapa[];
  puedeEditar: boolean;
}) {
  const router = useRouter();
  const [valores, setValores] = useState<Record<string, string>>(
    Object.fromEntries(etapas.map((e) => [e.stageId, e.estandar ?? ''])),
  );
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  return (
    <form
      className="seccion"
      aria-label="Mapa de etapas"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await enviar(`/api/configuracion/subcuentas/${locationId}/mapa-etapas`, 'PUT', {
          etapas: etapas.map((x) => ({
            stageId: x.stageId,
            etapaEstandar: valores[x.stageId] || null,
          })),
        });
        setMensaje(
          r.ok
            ? {
                tipo: 'ok',
                texto: `Mapa guardado (${numero(Number(r.datos.cambios ?? 0))} cambios). Las ventas pasadas se recalculan en la próxima carga nocturna.`,
              }
            : { tipo: 'error', texto: r.datos.error ?? 'No se pudo guardar.' },
        );
        if (r.ok) router.refresh();
      }}
    >
      <div className="fila-cabecera" style={{ flexWrap: 'wrap', padding: '20px 24px 12px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="seccion__titulo seccion__titulo--chico">Mapa de etapas</h2>
          <span className="seccion__nota">
            Marca como «Ganado» todas las etapas que ya cuentan como venta (por ejemplo, del
            adelanto en adelante). «Perdido» saca al lead de las métricas activas.
          </span>
        </div>
        {puedeEditar && etapas.length > 0 && <button className="boton">Guardar mapa</button>}
      </div>
      {mensaje && (
        <p
          className={`aviso aviso--${mensaje.tipo}`}
          role="status"
          style={{ margin: '0 24px 12px' }}
        >
          {mensaje.texto}
        </p>
      )}
      {etapas.length === 0 ? (
        <p className="vacio" style={{ margin: '0 24px 20px' }}>
          Aún no se cargaron las etapas de esta subcuenta.
        </p>
      ) : (
        <div className="tabla-caja">
          <table className="tabla" style={{ minWidth: 480 }}>
            <thead>
              <tr>
                <th scope="col">Etapa en GHL</th>
                <th scope="col">Cuenta como</th>
              </tr>
            </thead>
            <tbody>
              {etapas.map((e) => (
                <tr key={e.stageId}>
                  <td>
                    <span style={{ fontWeight: 600 }}>{e.nombre}</span>
                    {e.pipeline && (
                      <span style={{ fontSize: 12, color: 'var(--gris)' }}> · {e.pipeline}</span>
                    )}
                  </td>
                  <td>
                    <label>
                      <span className="oculto">Etapa estándar de {e.nombre}</span>
                      <select
                        className="control"
                        disabled={!puedeEditar}
                        value={valores[e.stageId] ?? ''}
                        onChange={(x) => setValores({ ...valores, [e.stageId]: x.target.value })}
                      >
                        <option value="">Sin asignar</option>
                        {Object.entries(NOMBRE_ESTANDAR).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </form>
  );
}

interface Estimacion {
  subcuentas: {
    locationId: string;
    nombre: string;
    error?: string;
    conversacionesElegibles?: number;
    muestra?: number;
    mensajesEstimados?: number;
    mensajesPorRegla?: number;
    conversacionesReutilizadas?: number;
    costoEstimadoUsd?: number;
    costoMaximoUsd?: number;
    manualesMes: number;
    enCurso: boolean;
  }[];
  costoEstimadoTotalUsd: number;
  costoMaximoTotalUsd: number;
  gastoDelMesUsd: number;
  topeMensualUsd: number;
  maxManualesMes: number;
  modelo: string;
  modeloNombre?: string;
}

const usd = (v: number) =>
  `US$ ${v.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;

/**
 * Botón "Ejecutar análisis de calidad" (§6.5): primero muestra la estimación (no gasta nada) y solo
 * después de confirmar con la contraseña (o el código 2FA) encola el análisis.
 */
export function LanzarAnalisis({
  subcuentas,
  desdeSugerido,
  hastaSugerido,
  conTotp,
}: {
  subcuentas: { id: string; nombre: string }[];
  desdeSugerido: string;
  hastaSugerido: string;
  conTotp: boolean;
}) {
  const router = useRouter();
  const [elegidas, setElegidas] = useState<string[]>(
    subcuentas.length === 1 ? [subcuentas[0]!.id] : [],
  );
  const [desde, setDesde] = useState(desdeSugerido);
  const [hasta, setHasta] = useState(hastaSugerido);
  const [est, setEst] = useState<Estimacion | null>(null);
  const [secreto, setSecreto] = useState('');
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [ocupado, setOcupado] = useState(false);

  const estimar = async () => {
    setOcupado(true);
    setEst(null);
    setMensaje({
      tipo: 'info',
      texto: 'Calculando la muestra y el costo estimado (no se envía nada a la IA)…',
    });
    const r = await enviar('/api/calidad/estimacion', 'POST', {
      subcuentas: elegidas,
      desde,
      hasta,
    });
    setOcupado(false);
    if (!r.ok) return setMensaje({ tipo: 'error', texto: r.datos.error ?? 'No se pudo estimar.' });
    setMensaje(null);
    setEst(r.datos as unknown as Estimacion);
  };

  const lanzar = async () => {
    setOcupado(true);
    const r = await enviar('/api/calidad/analisis', 'POST', {
      subcuentas: elegidas,
      desde,
      hasta,
      ...(conTotp ? { codigo: secreto } : { clave: secreto }),
    });
    setOcupado(false);
    setSecreto('');
    if (!r.ok)
      return setMensaje({
        tipo: 'error',
        texto: r.datos.error ?? 'No se pudo lanzar el análisis.',
      });
    setEst(null);
    setMensaje({
      tipo: 'ok',
      texto:
        'Análisis encolado. Se procesa por lotes y puede tardar hasta 24 horas; su avance aparece en el historial.',
    });
    router.refresh();
  };

  const bloqueos = est
    ? est.subcuentas.filter((s) => s.error || s.enCurso || s.manualesMes >= est.maxManualesMes)
    : [];
  const superaTope = est
    ? est.gastoDelMesUsd + est.costoMaximoTotalUsd > est.topeMensualUsd
    : false;

  return (
    <section aria-label="Ejecutar análisis de calidad" className="seccion seccion--relleno">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <h2 className="seccion__titulo seccion__titulo--chico">Ejecutar análisis de calidad</h2>
        <span className="seccion__nota">
          Califica una muestra de conversaciones de las 3 etapas de calidad. Primero verás cuánto
          costaría.
        </span>
      </div>
      {mensaje && (
        <p className={`aviso aviso--${mensaje.tipo}`} role="status">
          {mensaje.texto}
        </p>
      )}
      <form
        className="formulario-linea"
        onSubmit={(e) => {
          e.preventDefault();
          void estimar();
        }}
      >
        <fieldset
          style={{
            border: 0,
            margin: 0,
            padding: 0,
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            flex: '1 1 100%',
          }}
        >
          <legend className="campo" style={{ paddingBottom: 6 }}>
            Subcuentas
          </legend>
          {subcuentas.map((s) => {
            const on = elegidas.includes(s.id);
            return (
              <label
                key={s.id}
                className={`opcion-clara${on ? ' opcion-clara--on' : ''}`}
                style={{ minHeight: 44 }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() => {
                    setEst(null);
                    setElegidas(on ? elegidas.filter((x) => x !== s.id) : [...elegidas, s.id]);
                  }}
                />
                {s.nombre}
              </label>
            );
          })}
        </fieldset>
        <label className="campo">
          <span>Desde</span>
          <input
            className="control"
            type="date"
            required
            value={desde}
            max={hasta}
            onChange={(e) => {
              setEst(null);
              setDesde(e.target.value);
            }}
          />
        </label>
        <label className="campo">
          <span>Hasta</span>
          <input
            className="control"
            type="date"
            required
            value={hasta}
            min={desde}
            onChange={(e) => {
              setEst(null);
              setHasta(e.target.value);
            }}
          />
        </label>
        <button className="boton-sec boton-sec--azul" disabled={ocupado || elegidas.length === 0}>
          Calcular estimación
        </button>
      </form>

      {est && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="tabla-caja">
            <table className="tabla" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th scope="col">Subcuenta</th>
                  <th scope="col">Conversaciones elegibles</th>
                  <th scope="col">Muestra</th>
                  <th scope="col">Mensajes a calificar</th>
                  <th scope="col">Costo estimado</th>
                </tr>
              </thead>
              <tbody>
                {est.subcuentas.map((s) => (
                  <tr key={s.locationId}>
                    <td style={{ fontWeight: 600 }}>{s.nombre}</td>
                    {s.error ? (
                      <td colSpan={4} style={{ color: 'var(--rojo-texto)' }}>
                        {s.error}
                      </td>
                    ) : (
                      <>
                        <td>{numero(s.conversacionesElegibles)}</td>
                        <td>{numero(s.muestra)}</td>
                        <td>
                          {numero(s.mensajesEstimados)}
                          {(s.mensajesPorRegla ?? 0) > 0 && (
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--gris)' }}>
                              {numero(s.mensajesPorRegla)} saludos por regla, sin IA
                            </span>
                          )}
                          {(s.conversacionesReutilizadas ?? 0) > 0 && (
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--gris)' }}>
                              {numero(s.conversacionesReutilizadas)} conversaciones ya calificadas,
                              no se pagan otra vez
                            </span>
                          )}
                        </td>
                        <td>
                          {usd(s.costoEstimadoUsd ?? 0)}
                          {s.costoMaximoUsd !== undefined && (
                            <span style={{ display: 'block', fontSize: 12, color: 'var(--gris)' }}>
                              hasta {usd(s.costoMaximoUsd)}
                            </span>
                          )}
                          {s.enCurso && (
                            <span style={{ color: 'var(--rojo-texto)' }}>
                              {' '}
                              · ya tiene uno en curso
                            </span>
                          )}
                          {s.manualesMes >= est.maxManualesMes && (
                            <span style={{ color: 'var(--rojo-texto)' }}>
                              {' '}
                              · usó sus {est.maxManualesMes} del mes
                            </span>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={`aviso aviso--${superaTope || bloqueos.length ? 'error' : 'info'}`}>
            Costo esperado: <strong>{usd(est.costoEstimadoTotalUsd)}</strong> con{' '}
            {est.modeloNombre ?? est.modelo}; como máximo {usd(est.costoMaximoTotalUsd)} si la caché
            no funciona (este es el que se compara con el tope). Gastado este mes:{' '}
            {usd(est.gastoDelMesUsd)} de un tope de {usd(est.topeMensualUsd)}.
            {superaTope && ' En el peor caso, este análisis superaría el tope mensual.'}
          </p>
          {!superaTope && bloqueos.length === 0 && (
            <form
              className="formulario-linea"
              onSubmit={(e) => {
                e.preventDefault();
                void lanzar();
              }}
            >
              <label className="campo" style={{ flex: '1 1 240px' }}>
                <span>
                  {conTotp ? 'Código de verificación (2FA)' : 'Tu contraseña, para confirmar'}
                </span>
                <input
                  className="control"
                  required
                  type={conTotp ? 'text' : 'password'}
                  inputMode={conTotp ? 'numeric' : undefined}
                  autoComplete={conTotp ? 'one-time-code' : 'current-password'}
                  value={secreto}
                  onChange={(e) => setSecreto(e.target.value)}
                />
              </label>
              <button className="boton" disabled={ocupado}>
                Ejecutar análisis (unos {usd(est.costoEstimadoTotalUsd)})
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}

/** Zona horaria de la subcuenta (la de GHL puede no ser la del país donde opera el negocio). */
export function ZonaSubcuenta({
  locationId,
  nombre,
  zona,
  zonas,
}: {
  locationId: string;
  nombre: string;
  zona: string;
  zonas: Record<string, string>;
}) {
  const router = useRouter();
  const [valor, setValor] = useState(zona);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const opciones = zonas[zona] ? zonas : { [zona]: zona, ...zonas };
  return (
    <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label>
          <span className="oculto">Zona horaria de {nombre}</span>
          <select className="control" value={valor} onChange={(e) => setValor(e.target.value)}>
            {Object.entries(opciones).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        {valor !== zona && (
          <button
            type="button"
            className="boton-sec boton-sec--azul"
            onClick={async () => {
              const r = await enviar(`/api/configuracion/subcuentas/${locationId}/zona`, 'PUT', {
                zonaHoraria: valor,
              });
              setMensaje(
                r.ok
                  ? { tipo: 'ok', texto: 'Guardada. El historial se recalcula en unos minutos.' }
                  : { tipo: 'error', texto: r.datos.error ?? 'No se pudo guardar.' },
              );
              if (r.ok) router.refresh();
            }}
          >
            Guardar
          </button>
        )}
      </span>
      {mensaje && (
        <span
          style={{
            fontSize: 12,
            color: mensaje.tipo === 'error' ? 'var(--rojo-texto)' : 'var(--verde-texto)',
          }}
          role="status"
        >
          {mensaje.texto}
        </span>
      )}
    </span>
  );
}

interface OpcionModelo {
  id: string;
  nombre: string;
  resumen: string;
  costoRelativo: number;
}

/**
 * Modelo de IA y tope mensual de los análisis de calidad: los elige el administrador global. Aplica
 * desde el siguiente análisis, sin reiniciar el servidor.
 */
export function ModeloCalidad({
  modelos,
  modelo,
  topeMensualUsd,
  ultimoAnalisis,
}: {
  modelos: readonly OpcionModelo[];
  modelo: string;
  topeMensualUsd: number;
  ultimoAnalisis: { modelo: string | null; costoReal: number | null } | null;
}) {
  const router = useRouter();
  const [elegido, setElegido] = useState(modelo);
  const [tope, setTope] = useState(String(topeMensualUsd));
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [ocupado, setOcupado] = useState(false);
  const base = modelos.find((m) => m.id === ultimoAnalisis?.modelo);
  const comparar = (m: OpcionModelo) =>
    base && ultimoAnalisis?.costoReal
      ? (ultimoAnalisis.costoReal * m.costoRelativo) / base.costoRelativo
      : null;
  return (
    <form
      className="seccion seccion--relleno"
      aria-label="Modelo de IA"
      onSubmit={async (e) => {
        e.preventDefault();
        setOcupado(true);
        setMensaje(null);
        const r = await enviar('/api/configuracion/calidad', 'PUT', {
          modelo: elegido,
          topeMensualUsd: Number(tope),
        });
        setOcupado(false);
        setMensaje(
          r.ok
            ? { tipo: 'ok', texto: 'Guardado. Aplica desde el siguiente análisis.' }
            : { tipo: 'error', texto: r.datos.error ?? 'No se pudo guardar.' },
        );
        if (r.ok) router.refresh();
      }}
    >
      <div className="fila-cabecera" style={{ flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h2 className="seccion__titulo seccion__titulo--chico">Modelo de IA</h2>
          <span className="seccion__nota">
            Solo el administrador global lo cambia. Aplica a todas las subcuentas desde el siguiente
            análisis.
          </span>
        </div>
        <button className="boton" disabled={ocupado}>
          Guardar
        </button>
      </div>
      {mensaje && (
        <p className={`aviso aviso--${mensaje.tipo}`} role="status">
          {mensaje.texto}
        </p>
      )}
      <fieldset className="opciones-modelo">
        <legend className="oculto">Modelo</legend>
        {modelos.map((m) => {
          const costo = comparar(m);
          return (
            <label
              key={m.id}
              className={`opcion-clara opcion-modelo${elegido === m.id ? ' opcion-clara--on' : ''}`}
            >
              <input
                type="radio"
                name="modelo"
                value={m.id}
                checked={elegido === m.id}
                onChange={() => setElegido(m.id)}
              />
              <span className="opcion-modelo__textos">
                <strong>{m.nombre}</strong>
                <span>{m.resumen}</span>
                {costo !== null && (
                  <span className="opcion-modelo__costo">
                    El último análisis habría costado unos {usd(costo)}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>
      <label className="campo" style={{ maxWidth: 260 }}>
        <span>Tope de gasto mensual (US$)</span>
        <input
          className="control"
          type="number"
          min={1}
          max={1000}
          step={1}
          required
          value={tope}
          onChange={(e) => setTope(e.target.value)}
        />
      </label>
      <span className="seccion__nota">
        Suma todos los análisis del mes de todas las subcuentas. Si un análisis lo va a superar, se
        detiene antes de enviarse.
      </span>
    </form>
  );
}
