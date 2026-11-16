import { ETAPAS_PROCESO } from '@driven/core';
import { ESQUEMA_COLA } from '@driven/db';

/**
 * Punto de entrada del worker. En la fase 1 se conecta a pg-boss (esquema `comercial_cola`)
 * y en las fases siguientes registra los jobs de la sección 9 de la especificación.
 */
const modo = process.env.MODO_ALERTAS ?? 'sombra';
console.log(
  `[worker] iniciado en modo ${modo}. Cola: ${ESQUEMA_COLA}. Etapas: ${ETAPAS_PROCESO.join(', ')}`,
);
