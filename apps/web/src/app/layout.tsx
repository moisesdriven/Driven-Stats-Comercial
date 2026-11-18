import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
// Fuentes servidas desde el propio dominio (la CSP solo permite font-src 'self').
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/sora/500.css';
import '@fontsource/sora/600.css';
import '@fontsource/sora/700.css';
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
