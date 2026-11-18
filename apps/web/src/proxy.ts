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
  // Ruta pedida, para que el layout del panel revise el acceso antes de empezar a responder. Solo
  // en cargas completas de página (las de navegación interna, con cabecera RSC, las revisa cada
  // página): es donde importa responder 403 y no interfiere con el enrutador del navegador.
  cabeceras.delete('x-ruta');
  const navegacionInterna =
    request.headers.has('rsc') ||
    request.headers.has('next-router-state-tree') ||
    request.nextUrl.searchParams.has('_rsc');
  if (!navegacionInterna)
    cabeceras.set('x-ruta', request.nextUrl.pathname + request.nextUrl.search);
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
