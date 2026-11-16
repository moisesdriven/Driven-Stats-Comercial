/** Error con código HTTP que la API transforma en respuesta JSON. */
export class ErrorHttp extends Error {
  constructor(
    public readonly estado: number,
    mensaje: string,
    public readonly codigo?: string,
  ) {
    super(mensaje);
  }
}

export const noAutenticado = (m = 'Debes iniciar sesión.') =>
  new ErrorHttp(401, m, 'no_autenticado');
export const prohibido = (m = 'No tienes permiso para esta acción.') =>
  new ErrorHttp(403, m, 'prohibido');
export const noEncontrado = (m = 'No encontrado.') => new ErrorHttp(404, m, 'no_encontrado');
export const solicitudInvalida = (m: string) => new ErrorHttp(400, m, 'solicitud_invalida');
