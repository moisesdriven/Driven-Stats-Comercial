'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  MATRIZ_POR_DEFECTO,
  MODULOS,
  NOMBRES_ROL,
  ROLES,
  type Modulo,
  type Nivel,
  type Rol,
} from '@driven/core';
import { iniciales } from '@/lib/formato';
import { IconoBuscar, IconoCheck, IconoMas } from './Iconos';

export interface UsuarioUI {
  id: string;
  correo: string;
  nombre: string;
  rol: Rol;
  activo: boolean;
  subcuentas: string[];
  excepciones: Partial<Record<Modulo, Nivel>>;
  userIdGhl: string | null;
  totpActivo: boolean;
  ingreso: string;
}

const NOMBRE_MODULO: Record<Modulo, string> = {
  vista_general: 'Vista general',
  vista_subcuenta: 'Vista por subcuenta',
  detalle_asesores: 'Detalle de asesores',
  texto_mensajes: 'Texto de mensajes',
  horarios: 'Horarios y ausencias',
  metas: 'Metas y umbrales',
  exportar: 'Exportar',
  configuracion: 'Subcuentas, tokens y etapas',
  usuarios: 'Usuarios y accesos',
};
const DESCRIPCION_ROL: Record<Rol, string> = {
  admin: 'Todo el sistema: usuarios, accesos, subcuentas, tokens y configuración.',
  dueno: 'Una o varias subcuentas asignadas: su vista general, asesores y metas.',
  supervisor: 'Operación diaria de sus subcuentas: listas para actuar y horarios.',
  asesor: 'Solo su propio detalle e indicadores.',
};
const CHIP_ROL: Record<Rol, React.CSSProperties> = {
  admin: { background: '#0B0D12', color: '#FFFFFF' },
  dueno: { background: '#E8EEFF', color: '#1F5BFF' },
  supervisor: { background: '#F0F3F9', color: '#3A4252' },
  asesor: { background: '#E7F8EF', color: '#067647' },
};
const FIJOS_ADMIN: Modulo[] = ['usuarios', 'configuracion'];

interface Borrador {
  nombre: string;
  correo: string;
  rol: Rol;
  activo: boolean;
  subcuentas: string[];
  excepciones: Partial<Record<Modulo, Nivel>>;
  userIdGhl: string | null;
}

const vacio: Borrador = {
  nombre: '',
  correo: '',
  rol: 'supervisor',
  activo: true,
  subcuentas: [],
  excepciones: {},
  userIdGhl: null,
};
const deUsuario = (u: UsuarioUI): Borrador => ({
  nombre: u.nombre,
  correo: u.correo,
  rol: u.rol,
  activo: u.activo,
  subcuentas: u.subcuentas,
  excepciones: u.excepciones,
  userIdGhl: u.userIdGhl,
});

interface Props {
  usuarios: UsuarioUI[];
  subcuentas: { id: string; nombre: string }[];
  asesores: { userId: string; nombre: string; subcuentas: string[] }[];
  yo: string;
}

export function AdminUsuarios({ usuarios, subcuentas, asesores, yo }: Props) {
  const router = useRouter();
  const [buscar, setBuscar] = useState('');
  const [sel, setSel] = useState<string | 'nuevo'>(usuarios[0]?.id ?? 'nuevo');
  const actual = usuarios.find((u) => u.id === sel) ?? null;
  const [b, setB] = useState<Borrador>(actual ? deUsuario(actual) : vacio);
  const [mensaje, setMensaje] = useState<{
    tipo: 'ok' | 'error';
    texto: string;
    clave?: string;
  } | null>(null);
  const [enviando, setEnviando] = useState(false);

  const elegir = (id: string | 'nuevo') => {
    setSel(id);
    const u = usuarios.find((x) => x.id === id);
    setB(u ? deUsuario(u) : vacio);
    setMensaje(null);
  };

  const nombreSub = useMemo(() => new Map(subcuentas.map((s) => [s.id, s.nombre])), [subcuentas]);
  const filtrados = usuarios.filter((u) =>
    `${u.nombre} ${u.correo}`.toLowerCase().includes(buscar.trim().toLowerCase()),
  );
  const conteo = Object.fromEntries(
    ROLES.map((r) => [r, usuarios.filter((u) => u.rol === r && u.activo).length]),
  ) as Record<Rol, number>;
  const nivel = (m: Modulo): Nivel =>
    b.rol === 'admin' && FIJOS_ADMIN.includes(m)
      ? 'editar'
      : (b.excepciones[m] ?? MATRIZ_POR_DEFECTO[b.rol][m]);
  const fijarNivel = (m: Modulo, n: Nivel) =>
    setB((x) => {
      const exc = { ...x.excepciones };
      if (n === MATRIZ_POR_DEFECTO[x.rol][m]) delete exc[m];
      else exc[m] = n;
      return { ...x, excepciones: exc };
    });
  const asesoresDisponibles = asesores.filter(
    (a) => b.subcuentas.length === 0 || a.subcuentas.some((s) => b.subcuentas.includes(s)),
  );

  const llamar = async (url: string, metodo: string, cuerpo?: unknown) => {
    setEnviando(true);
    setMensaje(null);
    const r = await fetch(url, {
      method: metodo,
      headers: { 'content-type': 'application/json' },
      ...(cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
    });
    setEnviando(false);
    const datos = (await r.json().catch(() => ({}))) as {
      error?: string;
      id?: string;
      claveTemporal?: string;
    };
    if (!r.ok)
      setMensaje({ tipo: 'error', texto: datos.error ?? 'No se pudo completar la acción.' });
    return r.ok ? datos : null;
  };

  const guardar = async () => {
    const accesos = {
      rol: b.rol,
      subcuentas: b.rol === 'admin' ? [] : b.subcuentas,
      excepciones: b.excepciones,
      userIdGhl: b.rol === 'asesor' ? b.userIdGhl : null,
    };
    if (sel === 'nuevo') {
      const r = await llamar('/api/usuarios', 'POST', {
        correo: b.correo,
        nombre: b.nombre,
        ...accesos,
      });
      if (r?.id) {
        setSel(r.id);
        setMensaje({
          tipo: 'ok',
          texto:
            'Usuario creado. Entrégale esta contraseña temporal; deberá cambiarla al ingresar. No se volverá a mostrar.',
          ...(r.claveTemporal ? { clave: r.claveTemporal } : {}),
        });
        router.refresh();
      }
      return;
    }
    const r = await llamar(`/api/usuarios/${sel}`, 'PATCH', {
      nombre: b.nombre,
      activo: b.activo,
      ...accesos,
    });
    if (r) {
      setMensaje({
        tipo: 'ok',
        texto: 'Cambios guardados. Se aplican desde la siguiente acción del usuario.',
      });
      router.refresh();
    }
  };

  const restablecer = async () => {
    if (
      !actual ||
      !confirm(`¿Restablecer la contraseña de ${actual.nombre}? Se cerrarán sus sesiones abiertas.`)
    )
      return;
    const r = await llamar(`/api/usuarios/${actual.id}/restablecer-clave`, 'POST');
    if (r?.claveTemporal)
      setMensaje({
        tipo: 'ok',
        texto:
          'Contraseña restablecida. Entrégale esta contraseña temporal; no se volverá a mostrar.',
        clave: r.claveTemporal,
      });
  };

  return (
    <>
      <div className="encabezado">
        <div className="encabezado__textos">
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 }}>
            <h1 className="titulo">Usuarios y accesos</h1>
            <span className="chip-tipo" style={{ background: '#E8EEFF', color: '#1F5BFF' }}>
              Solo administradores
            </span>
          </div>
          <p className="subtitulo">
            Define quién entra, con qué rol, a qué subcuentas y qué módulos puede ver o editar.
          </p>
        </div>
        <button type="button" className="boton" onClick={() => elegir('nuevo')}>
          <IconoMas /> Nuevo usuario
        </button>
      </div>

      <section
        aria-label="Roles"
        className="rejilla"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}
      >
        {ROLES.map((r) => (
          <div key={r} className={`tarjeta-rol${r === 'admin' ? ' tarjeta-rol--oscura' : ''}`}>
            <div className="fila-cabecera">
              <span style={{ fontFamily: 'var(--titulos)', fontSize: 16, fontWeight: 700 }}>
                {NOMBRES_ROL[r]}
              </span>
              <span style={{ fontSize: 12, fontWeight: 600, opacity: 0.85 }}>
                {conteo[r]} {conteo[r] === 1 ? 'usuario' : 'usuarios'}
              </span>
            </div>
            <span style={{ fontSize: 13, opacity: 0.85 }}>{DESCRIPCION_ROL[r]}</span>
          </div>
        ))}
      </section>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start' }}>
        <section
          aria-label="Lista de usuarios"
          className="seccion"
          style={{ flex: '999 1 560px', minWidth: 0 }}
        >
          <div className="fila-cabecera" style={{ flexWrap: 'wrap', padding: '18px 20px' }}>
            <h2 className="seccion__titulo">Usuarios</h2>
            <label className="control" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <IconoBuscar />
              <span className="oculto">Buscar usuario</span>
              <input
                type="search"
                placeholder="Buscar por nombre o correo"
                value={buscar}
                onChange={(e) => setBuscar(e.target.value)}
                style={{
                  border: 0,
                  outline: 'none',
                  font: 'inherit',
                  fontSize: 14,
                  width: 200,
                  background: 'transparent',
                }}
              />
            </label>
          </div>
          <div className="tabla-caja">
            <table className="tabla" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th scope="col">Usuario</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Subcuentas</th>
                  <th scope="col">Último ingreso</th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map((u) => (
                  <tr
                    key={u.id}
                    style={
                      u.id === sel
                        ? { background: '#EEF3FF' }
                        : u.activo
                          ? undefined
                          : { opacity: 0.55 }
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className="con-avatar"
                        onClick={() => elegir(u.id)}
                        aria-pressed={u.id === sel}
                        style={{
                          minHeight: 44,
                          padding: 0,
                          border: 0,
                          background: 'transparent',
                          font: 'inherit',
                          textAlign: 'left',
                          cursor: 'pointer',
                          color: 'inherit',
                        }}
                      >
                        <span className="avatar-chico" aria-hidden="true">
                          {iniciales(u.nombre)}
                        </span>
                        <span style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>
                            {u.nombre}
                            {!u.activo && ' (inactivo)'}
                          </span>
                          <span style={{ fontSize: 12, color: '#5B6475' }}>{u.correo}</span>
                        </span>
                      </button>
                    </td>
                    <td>
                      <span className="chip-tipo" style={CHIP_ROL[u.rol]}>
                        {NOMBRES_ROL[u.rol]}
                      </span>
                    </td>
                    <td style={{ fontSize: 13, color: '#3A4252' }}>
                      {u.rol === 'admin'
                        ? 'Todas'
                        : u.subcuentas.map((s) => nombreSub.get(s) ?? s).join(', ') || 'Ninguna'}
                    </td>
                    <td style={{ fontSize: 13, color: '#5B6475' }}>{u.ingreso}</td>
                  </tr>
                ))}
                {filtrados.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: '#5B6475' }}>
                      Ningún usuario coincide con la búsqueda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <form
          aria-label={sel === 'nuevo' ? 'Nuevo usuario' : 'Editar acceso'}
          className="panel-oscuro"
          style={{ flex: '1 1 380px' }}
          onSubmit={(e) => {
            e.preventDefault();
            void guardar();
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span
              className="avatar-grande"
              style={{ width: 48, height: 48, borderRadius: 14, fontSize: 18 }}
              aria-hidden="true"
            >
              {sel === 'nuevo' ? <IconoMas /> : iniciales(b.nombre)}
            </span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <h2 className="seccion__titulo">{sel === 'nuevo' ? 'Nuevo usuario' : b.nombre}</h2>
              <span style={{ fontSize: 13, color: '#B4BCCC' }}>
                {sel === 'nuevo'
                  ? 'Recibirá una contraseña temporal'
                  : `${b.correo}${actual?.totpActivo ? ' · verificación en dos pasos activa' : ''}`}
              </span>
            </div>
          </div>

          {mensaje && (
            <div
              className={`aviso aviso--${mensaje.tipo === 'ok' ? 'oscuro' : 'error'}`}
              role="status"
            >
              {mensaje.texto}
              {mensaje.clave && (
                <div className="clave-temporal" style={{ marginTop: 8 }}>
                  {mensaje.clave}
                </div>
              )}
            </div>
          )}

          {sel === 'nuevo' ? (
            <>
              <label className="campo-oscuro">
                Nombre
                <input
                  required
                  maxLength={120}
                  value={b.nombre}
                  onChange={(e) => setB({ ...b, nombre: e.target.value })}
                />
              </label>
              <label className="campo-oscuro">
                Correo
                <input
                  required
                  type="email"
                  autoComplete="off"
                  value={b.correo}
                  onChange={(e) => setB({ ...b, correo: e.target.value })}
                />
              </label>
            </>
          ) : (
            <label className="campo-oscuro">
              Nombre
              <input
                required
                maxLength={120}
                value={b.nombre}
                onChange={(e) => setB({ ...b, nombre: e.target.value })}
              />
            </label>
          )}

          <fieldset>
            <legend>Rol</legend>
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}
            >
              {ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  className="opcion-oscura opcion-oscura--rol"
                  aria-pressed={b.rol === r}
                  onClick={() => setB({ ...b, rol: r, excepciones: {} })}
                  disabled={actual?.id === yo && r !== 'admin'}
                >
                  {NOMBRES_ROL[r]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>Subcuentas con acceso</legend>
            {b.rol === 'admin' ? (
              <span
                className="nota-oscura"
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                El administrador ve todas las subcuentas.
              </span>
            ) : (
              <>
                {subcuentas.map((s) => {
                  const on = b.subcuentas.includes(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      className="opcion-oscura"
                      onClick={() =>
                        setB({
                          ...b,
                          subcuentas: on
                            ? b.subcuentas.filter((x) => x !== s.id)
                            : [...b.subcuentas, s.id],
                        })
                      }
                    >
                      <span
                        className={`caja-check${on ? ' caja-check--on' : ''}`}
                        aria-hidden="true"
                      >
                        {on && <IconoCheck />}
                      </span>
                      {s.nombre}
                    </button>
                  );
                })}
                <span className="nota-oscura">
                  {b.rol === 'dueno'
                    ? 'Un dueño de negocio puede tener una o varias subcuentas; su vista general suma solo las suyas.'
                    : 'Solo verá datos de las subcuentas marcadas.'}
                </span>
              </>
            )}
          </fieldset>

          {b.rol === 'asesor' && (
            <label className="campo-oscuro">
              Usuario de GHL vinculado (obligatorio para un asesor)
              <select
                required
                value={b.userIdGhl ?? ''}
                onChange={(e) => setB({ ...b, userIdGhl: e.target.value || null })}
              >
                <option value="">Elige al asesor…</option>
                {asesoresDisponibles.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.nombre}
                  </option>
                ))}
              </select>
            </label>
          )}

          <fieldset>
            <legend>Módulos</legend>
            <div className="modulos" role="table" aria-label="Módulos y nivel de acceso">
              <div className="modulos__fila modulos__fila--cabecera" role="row">
                <span role="columnheader">Módulo</span>
                <span role="columnheader" className="modulos__celda">
                  Ver
                </span>
                <span role="columnheader" className="modulos__celda">
                  Editar
                </span>
              </div>
              {MODULOS.map((m) => {
                const n = nivel(m);
                const fijo = b.rol === 'admin' && FIJOS_ADMIN.includes(m);
                const excepcion = b.excepciones[m] !== undefined;
                return (
                  <div key={m} className="modulos__fila" role="row">
                    <span role="cell">
                      {NOMBRE_MODULO[m]}
                      {excepcion && <span className="oculto"> (excepción para este usuario)</span>}
                    </span>
                    <span role="cell" className="modulos__celda">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={n !== 'ninguno'}
                        aria-label={`Ver ${NOMBRE_MODULO[m]}`}
                        disabled={fijo}
                        className={`casilla${n !== 'ninguno' ? ' casilla--on' : ''}${excepcion ? ' casilla--excepcion' : ''}`}
                        onClick={() => fijarNivel(m, n === 'ninguno' ? 'ver' : 'ninguno')}
                      >
                        {n !== 'ninguno' && <IconoCheck />}
                      </button>
                    </span>
                    <span role="cell" className="modulos__celda">
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={n === 'editar'}
                        aria-label={`Editar ${NOMBRE_MODULO[m]}`}
                        disabled={fijo}
                        className={`casilla${n === 'editar' ? ' casilla--on' : ''}${excepcion ? ' casilla--excepcion' : ''}`}
                        onClick={() => fijarNivel(m, n === 'editar' ? 'ver' : 'editar')}
                      >
                        {n === 'editar' && <IconoCheck />}
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>
            <span className="nota-oscura">
              Valores por defecto del rol. Las casillas con borde amarillo son excepciones de este
              usuario.
            </span>
          </fieldset>

          {sel !== 'nuevo' && actual?.id !== yo && (
            <label className="opcion-oscura" style={{ cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={b.activo}
                onChange={(e) => setB({ ...b, activo: e.target.checked })}
              />
              Usuario activo (si se desactiva, se cierran sus sesiones)
            </label>
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <button className="boton" disabled={enviando}>
              {enviando ? 'Guardando…' : sel === 'nuevo' ? 'Crear usuario' : 'Guardar cambios'}
            </button>
            {sel !== 'nuevo' && (
              <button
                type="button"
                className="boton-sec"
                style={{
                  background: 'transparent',
                  color: '#fff',
                  borderColor: 'rgba(255,255,255,0.28)',
                }}
                onClick={() => void restablecer()}
                disabled={enviando}
              >
                Restablecer contraseña
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
