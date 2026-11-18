'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';

/** Subcuenta que se está mirando: la de la ruta (`/subcuentas/{id}`) o la del filtro (`?subcuenta=`). */
function subcuentaActual(ruta: string, params: URLSearchParams): string | null {
  return /^\/subcuentas\/([^/]+)/.exec(ruta)?.[1] ?? params.get('subcuenta');
}

/**
 * Enlace del menú que se marca como actual (aria-current) según la ruta. Con `conSubcuenta`, lleva
 * la subcuenta que se está mirando al módulo de destino (Asesores, Horarios, Metas son por
 * subcuenta).
 */
export function EnlaceMenu({
  href,
  clase,
  exacto = false,
  conSubcuenta = false,
  tambien,
  salvo,
  children,
}: {
  href: string;
  clase: string;
  exacto?: boolean;
  conSubcuenta?: boolean;
  /** También se marca como actual si la ruta contiene este tramo (p. ej. `/asesores/`). */
  tambien?: string;
  /** No se marca como actual si la ruta contiene este tramo. */
  salvo?: string;
  children: ReactNode;
}) {
  const ruta = usePathname();
  const params = useSearchParams();
  const propia = exacto ? ruta === href : ruta === href || ruta.startsWith(`${href}/`);
  const actual =
    (propia && !(salvo && ruta.includes(salvo))) || Boolean(tambien && ruta.includes(tambien));
  const sub = conSubcuenta ? subcuentaActual(ruta, params) : null;
  const destino = sub ? `${href}?subcuenta=${encodeURIComponent(sub)}` : href;
  return (
    <Link href={destino} className={clase} aria-current={actual ? 'page' : undefined}>
      {children}
    </Link>
  );
}
