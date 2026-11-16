import type { Metadata } from 'next';
import type { ReactNode } from 'react';
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
