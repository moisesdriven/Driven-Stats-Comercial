import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
// Fuentes servidas desde el propio dominio (la CSP solo permite font-src 'self').
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
import { COOKIE_TEMA, esTema } from '@/lib/preferencias';
import './globales.css';

export const metadata: Metadata = {
  title: 'Driven Comercial',
  description: 'Medición de la eficiencia de los equipos comerciales',
};

// Tema claro y oscuro según el sistema: <meta name="color-scheme"> evita el destello claro al cargar.
export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f3f5fa' },
    { media: '(prefers-color-scheme: dark)', color: '#0b0d12' },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Tema elegido con el botón del menú; sin elección, sigue al sistema.
  const tema = (await cookies()).get(COOKIE_TEMA)?.value;
  return (
    <html lang="es" data-tema={esTema(tema) ? tema : undefined}>
      <body>{children}</body>
    </html>
  );
}
