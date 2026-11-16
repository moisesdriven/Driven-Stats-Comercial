'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

/** Enlace del menú que se marca como actual (aria-current) según la ruta. */
export function EnlaceMenu({
  href,
  clase,
  exacto = false,
  children,
}: {
  href: string;
  clase: string;
  exacto?: boolean;
  children: ReactNode;
}) {
  const ruta = usePathname();
  const actual = exacto ? ruta === href : ruta === href || ruta.startsWith(`${href}/`);
  return (
    <Link href={href} className={clase} aria-current={actual ? 'page' : undefined}>
      {children}
    </Link>
  );
}
