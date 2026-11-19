'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import {
  ATAJOS,
  diaSemana,
  etiquetaPeriodo,
  finMes,
  inicioMes,
  PERIODO_POR_DEFECTO,
  rangoDeAtajo,
  sumarDias,
  type ClavePeriodo,
} from '@/lib/rangos';
import { IconoCalendario, IconoFlecha } from './Iconos';

interface Borrador {
  clave: ClavePeriodo;
  desde: string;
  hasta: string;
}

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
/** «Octubre de 2026» (solo la primera letra en mayúscula). */
const nombreMes = (iso: string) => {
  const t = new Intl.DateTimeFormat('es-PE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${iso}T12:00:00Z`));
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat('es-PE', { dateStyle: 'full', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`),
  );
const mesAnterior = (iso: string) => inicioMes(sumarDias(inicioMes(iso), -1));
const mesSiguiente = (iso: string) => sumarDias(finMes(iso), 1);

/**
 * Selector de periodo (pedido del cliente del 19 nov 2026): un botón con el periodo elegido que
 * abre atajos (hoy, últimos 7 días, mes pasado…) y un calendario de dos meses para un rango
 * personalizado. El periodo se aplica con «Actualizar» y viaja en la URL, así la página recalcula
 * en el servidor.
 */
export function SelectorFechas({
  clave,
  desde,
  hasta,
  hoy,
  zona = 'Lima',
}: {
  clave: ClavePeriodo;
  desde: string;
  hasta: string;
  hoy: string;
  /** Nombre de la zona horaria para la nota al pie. */
  zona?: string;
}) {
  const router = useRouter();
  const ruta = usePathname();
  const params = useSearchParams();
  const id = useId();
  const raiz = useRef<HTMLDivElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [b, setB] = useState<Borrador>({ clave, desde, hasta });
  // Mes de la derecha del calendario (el de la izquierda es el anterior).
  const [vista, setVista] = useState(inicioMes(hasta));
  // Primer clic de un rango personalizado: falta el segundo.
  const [eligiendo, setEligiendo] = useState(false);
  const [sobre, setSobre] = useState<string | null>(null);

  // Al abrir, el borrador parte del periodo vigente.
  const abrir = () => {
    setB({ clave, desde, hasta });
    setVista(inicioMes(hasta));
    setEligiendo(false);
    setAbierto(true);
  };
  const cerrar = () => {
    setAbierto(false);
    boton.current?.focus();
  };

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: PointerEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    document.addEventListener('pointerdown', fuera);
    document.addEventListener('keydown', tecla);
    raiz.current?.querySelector<HTMLInputElement>('input[name$="-atajo"]:checked')?.focus();
    return () => {
      document.removeEventListener('pointerdown', fuera);
      document.removeEventListener('keydown', tecla);
    };
  }, [abierto]);

  const elegirAtajo = (c: ClavePeriodo) => {
    setEligiendo(false);
    if (c === 'rango') {
      setB({ ...b, clave: 'rango' });
      return;
    }
    const r = rangoDeAtajo(c, hoy);
    setB({ clave: c, ...r });
    setVista(inicioMes(r.hasta));
  };

  const elegirDia = (dia: string) => {
    if (!eligiendo) {
      setB({ clave: 'rango', desde: dia, hasta: dia });
      setEligiendo(true);
      return;
    }
    setB(dia < b.desde ? { clave: 'rango', desde: dia, hasta: b.desde } : { ...b, hasta: dia });
    setEligiendo(false);
    setSobre(null);
  };

  const aplicar = () => {
    const p = new URLSearchParams(params.toString());
    p.delete('desde');
    p.delete('hasta');
    if (b.clave === PERIODO_POR_DEFECTO) p.delete('periodo');
    else p.set('periodo', b.clave);
    if (b.clave === 'rango') {
      p.set('desde', b.desde);
      p.set('hasta', b.hasta);
    }
    const qs = p.toString();
    setAbierto(false);
    router.push(qs ? `${ruta}?${qs}` : ruta);
  };

  // Rango que se pinta: con el primer clic hecho, sigue al puntero hasta el segundo.
  const pintado = (() => {
    if (eligiendo && sobre) return sobre < b.desde ? [sobre, b.desde] : [b.desde, sobre];
    return [b.desde, b.hasta];
  })() as [string, string];

  const mes = (inicio: string) => {
    const blancos = diaSemana(inicio);
    const dias: string[] = [];
    for (let d = inicio; d <= finMes(inicio); d = sumarDias(d, 1)) dias.push(d);
    return (
      <div className="calendario__mes" key={inicio}>
        <div className="calendario__titulo">{nombreMes(inicio)}</div>
        <div className="calendario__rejilla" role="grid" aria-label={nombreMes(inicio)}>
          {DIAS.map((d) => (
            <span key={d} className="calendario__dia-semana" aria-hidden="true">
              {d}
            </span>
          ))}
          {Array.from({ length: blancos }, (_, i) => (
            <span key={`b${i}`} aria-hidden="true" />
          ))}
          {dias.map((d) => {
            const futuro = d > hoy;
            const dentro = d >= pintado[0] && d <= pintado[1];
            const extremo = d === pintado[0] || d === pintado[1];
            return (
              <button
                key={d}
                type="button"
                className={[
                  'calendario__dia',
                  dentro ? 'calendario__dia--rango' : '',
                  extremo ? 'calendario__dia--extremo' : '',
                  d === hoy ? 'calendario__dia--hoy' : '',
                ].join(' ')}
                disabled={futuro}
                aria-pressed={extremo}
                aria-label={fechaLarga(d)}
                onClick={() => elegirDia(d)}
                onPointerEnter={() => eligiendo && setSobre(d)}
              >
                {Number(d.slice(8))}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const izquierda = mesAnterior(vista);
  return (
    <div className="selector-fechas" ref={raiz}>
      <button
        ref={boton}
        type="button"
        className="selector-fechas__boton"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={abierto ? `${id}-panel` : undefined}
        onClick={() => (abierto ? cerrar() : abrir())}
      >
        <IconoCalendario />
        <span>{etiquetaPeriodo(clave, desde, hasta)}</span>
        <IconoFlecha dir="abajo" />
      </button>
      {abierto && (
        <div
          id={`${id}-panel`}
          className="selector-fechas__panel"
          role="dialog"
          aria-label="Elegir periodo"
        >
          <fieldset className="selector-fechas__atajos">
            <legend className="oculto">Periodo</legend>
            {ATAJOS.map((a) => (
              <label key={a.clave} className="selector-fechas__atajo">
                <input
                  type="radio"
                  name={`${id}-atajo`}
                  value={a.clave}
                  checked={b.clave === a.clave}
                  onChange={() => elegirAtajo(a.clave)}
                />
                {a.texto}
              </label>
            ))}
          </fieldset>
          <div className="selector-fechas__cuerpo">
            <div className="calendario">
              <button
                type="button"
                className="calendario__nav calendario__nav--izq"
                aria-label="Mes anterior"
                onClick={() => setVista(mesAnterior(vista))}
              >
                <IconoFlecha dir="izq" />
              </button>
              {mes(izquierda)}
              {mes(vista)}
              <button
                type="button"
                className="calendario__nav calendario__nav--der"
                aria-label="Mes siguiente"
                disabled={vista >= inicioMes(hoy)}
                onClick={() => setVista(mesSiguiente(vista))}
              >
                <IconoFlecha dir="der" />
              </button>
            </div>
            <div className="selector-fechas__fechas">
              <label className="filtro">
                Desde
                <input
                  className="control"
                  type="date"
                  value={b.desde}
                  max={b.hasta}
                  onChange={(e) =>
                    e.target.value &&
                    setB({ clave: 'rango', desde: e.target.value, hasta: b.hasta })
                  }
                />
              </label>
              <label className="filtro">
                Hasta
                <input
                  className="control"
                  type="date"
                  value={b.hasta}
                  min={b.desde}
                  max={hoy}
                  onChange={(e) =>
                    e.target.value &&
                    setB({ clave: 'rango', desde: b.desde, hasta: e.target.value })
                  }
                />
              </label>
            </div>
            <div className="selector-fechas__pie">
              <span className="selector-fechas__nota">Las fechas están en la hora de {zona}.</span>
              <div className="selector-fechas__acciones">
                <button type="button" className="boton-sec" onClick={cerrar}>
                  Cancelar
                </button>
                <button type="button" className="boton" onClick={aplicar} disabled={eligiendo}>
                  Actualizar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
