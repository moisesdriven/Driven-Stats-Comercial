/** El texto de los mensajes se guarda 90 días (tarea `purga:textos`); las clasificaciones se conservan. */
export const DIAS_RETENCION_TEXTO = 90;

/** Instante antes del cual ya no se guarda el texto de un mensaje. */
export const corteRetencionTexto = (ahora = new Date()) =>
  new Date(ahora.getTime() - DIAS_RETENCION_TEXTO * 86_400_000);
