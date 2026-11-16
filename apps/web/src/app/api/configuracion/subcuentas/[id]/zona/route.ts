import { esquemaZonaHoraria, guardarZonaHoraria } from '@/servidor/configuracion';
import { obtenerDb } from '@/servidor/db';
import { json, leerJson, manejar, requerirSesion } from '@/servidor/http';

/** Zona horaria de la subcuenta (la de GHL puede no ser la del país donde opera el negocio). */
export const PUT = manejar(async (req, { params }: { params: Promise<{ id: string }> }) => {
  const { ctx } = await requerirSesion(req);
  const datos = await leerJson(req, esquemaZonaHoraria);
  return json(await guardarZonaHoraria(obtenerDb(), ctx, (await params).id, datos));
});
