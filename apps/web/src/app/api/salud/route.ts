import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Healthcheck usado por Docker y por los scripts de despliegue. */
export function GET() {
  return NextResponse.json({ estado: 'ok', servicio: 'web', hora: new Date().toISOString() });
}
