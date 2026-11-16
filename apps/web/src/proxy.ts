import { NextResponse, type NextRequest } from 'next/server';

/**
 * Política de seguridad de contenido estricta (§11) con un nonce por petición: solo se ejecutan los
 * scripts propios de Next marcados con ese nonce. Las rutas /api tienen su propia CSP (next.config).
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const desarrollo = process.env.NODE_ENV !== 'production';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${desarrollo ? " 'unsafe-eval'" : ''}`,
    // React aplica estilos en línea (atributo style) para replicar el diseño aprobado.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    ...(desarrollo ? [] : ['upgrade-insecure-requests']),
  ].join('; ');

  const cabeceras = new Headers(request.headers);
  cabeceras.set('x-nonce', nonce);
  cabeceras.set('Content-Security-Policy', csp);
  const respuesta = NextResponse.next({ request: { headers: cabeceras } });
  respuesta.headers.set('Content-Security-Policy', csp);
  return respuesta;
}

export const config = {
  matcher: [
    {
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
