import type { Metadata } from 'next';
import type { ReactNode } from 'react';
// Fuentes servidas desde el propio dominio (la CSP solo permite font-src 'self').
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/space-grotesk/700.css';
import './globales.css';

export const metadata: Metadata = {
  title: 'Driven Comercial',
  description: 'Medición de la eficiencia de los equipos comerciales',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
