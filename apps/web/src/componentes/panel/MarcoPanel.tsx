'use client';

import { usePathname } from 'next/navigation';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
  COOKIE_MENU,
  COOKIE_TEMA,
  guardarPreferencia,
  MENU_CONTRAIDO,
  type Tema,
} from '@/lib/preferencias';
import { IconoContraer, IconoHamburguesa, IconoLuna, IconoSol, IconoTendencia } from './Iconos';

/** En pantallas angostas el menú es un panel que entra desde la izquierda. */
const CONSULTA_MOVIL = '(max-width: 900px)';

interface EstadoMenu {
  /** Escritorio: menú reducido a íconos. */
  contraido: boolean;
  alternarContraido: () => void;
  /** Celular: panel del menú abierto. */
  abierto: boolean;
  cerrar: () => void;
}

const Contexto = createContext<EstadoMenu>({
  contraido: false,
  alternarContraido: () => {},
  abierto: false,
  cerrar: () => {},
});

export const useMenu = () => useContext(Contexto);

/**
 * Marco del panel: el menú lateral contraíble (escritorio) o deslizable (celular) y el área de
 * trabajo. La preferencia de contraído se guarda en una cookie que lee el servidor.
 */
export function MarcoPanel({
  contraidoInicial,
  menu,
  children,
}: {
  contraidoInicial: boolean;
  menu: ReactNode;
  children: ReactNode;
}) {
  const [contraido, setContraido] = useState(contraidoInicial);
  const [abierto, setAbierto] = useState(false);
  const ruta = usePathname();

  // Al navegar, el panel del celular se cierra.
  useEffect(() => setAbierto(false), [ruta]);

  useEffect(() => {
    if (!abierto) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false);
    };
    document.addEventListener('keydown', tecla);
    document.querySelector<HTMLElement>('#menu-lateral a, #menu-lateral button')?.focus();
    return () => document.removeEventListener('keydown', tecla);
  }, [abierto]);

  const estado: EstadoMenu = {
    contraido,
    alternarContraido: () => {
      // En el celular este botón cierra el panel; en escritorio contrae o expande.
      if (window.matchMedia(CONSULTA_MOVIL).matches) {
        setAbierto(false);
        return;
      }
      const nuevo = !contraido;
      setContraido(nuevo);
      guardarPreferencia(COOKIE_MENU, nuevo ? MENU_CONTRAIDO : 'expandido');
    },
    abierto,
    cerrar: () => setAbierto(false),
  };

  return (
    <Contexto.Provider value={estado}>
      <div
        className={`panel${contraido ? ' panel--contraido' : ''}${abierto ? ' panel--menu-abierto' : ''}`}
      >
        <header className="barra-movil">
          <button
            type="button"
            className="barra-movil__boton"
            aria-expanded={abierto}
            aria-controls="menu-lateral"
            onClick={() => setAbierto(true)}
          >
            <IconoHamburguesa />
            <span className="oculto">Abrir menú</span>
          </button>
          <span className="barra-movil__marca">
            <span className="menu__logo" aria-hidden="true">
              <IconoTendencia />
            </span>
            Driven Comercial
          </span>
        </header>
        {menu}
        {abierto && (
          <div className="velo-menu" aria-hidden="true" onClick={() => setAbierto(false)} />
        )}
        <main className="contenido">{children}</main>
      </div>
    </Contexto.Provider>
  );
}

/** Contraer o expandir el menú (escritorio); cerrarlo (celular). */
export function BotonContraer() {
  const { contraido, alternarContraido, abierto } = useMenu();
  const texto = abierto ? 'Cerrar menú' : contraido ? 'Expandir menú' : 'Contraer menú';
  return (
    <button
      type="button"
      className="menu__contraer"
      onClick={alternarContraido}
      aria-label={texto}
      title={texto}
      aria-expanded={abierto || !contraido}
    >
      <IconoContraer abierto={abierto || !contraido} />
    </button>
  );
}

/**
 * Alterna entre modo claro y oscuro. Sin elección previa parte del tema del sistema. Se guarda en
 * una cookie: el servidor la aplica en <html data-tema> desde la primera carga.
 */
export function BotonTema() {
  const [tema, setTema] = useState<Tema | null>(null);
  useEffect(() => {
    const actual = document.documentElement.dataset.tema;
    setTema(
      actual === 'claro' || actual === 'oscuro'
        ? actual
        : window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'oscuro'
          : 'claro',
    );
  }, []);
  const siguiente: Tema = tema === 'oscuro' ? 'claro' : 'oscuro';
  const texto = siguiente === 'oscuro' ? 'Modo oscuro' : 'Modo claro';
  const { contraido } = useMenu();
  return (
    <button
      type="button"
      className="menu__enlace menu__tema"
      title={contraido ? texto : undefined}
      onClick={() => {
        document.documentElement.dataset.tema = siguiente;
        guardarPreferencia(COOKIE_TEMA, siguiente);
        setTema(siguiente);
      }}
    >
      {siguiente === 'oscuro' ? <IconoLuna /> : <IconoSol />}
      <span className="menu__texto">{texto}</span>
    </button>
  );
}
