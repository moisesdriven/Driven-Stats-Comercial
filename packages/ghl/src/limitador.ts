/**
 * Límite de ráfaga por subcuenta. GHL permite 100 llamadas cada 10 s por subcuenta (headers
 * x-ratelimit-max / x-ratelimit-interval-milliseconds). Se usa un margen (por defecto 80) porque
 * Driven Conteo consulta las mismas subcuentas.
 */
export type Esperar = (ms: number) => Promise<void>;
export const esperarReal: Esperar = (ms) => new Promise((r) => setTimeout(r, ms));

export class Limitador {
  private marcas: number[] = [];
  private pausaHasta = 0;

  constructor(
    private readonly maxPorVentana = 80,
    private readonly ventanaMs = 10_000,
    private readonly esperar: Esperar = esperarReal,
    private readonly ahora: () => number = Date.now,
  ) {}

  /** Espera hasta que haya cupo y lo reserva. */
  async turno(): Promise<void> {
    for (;;) {
      const t = this.ahora();
      if (t < this.pausaHasta) {
        await this.esperar(this.pausaHasta - t);
        continue;
      }
      this.marcas = this.marcas.filter((m) => t - m < this.ventanaMs);
      if (this.marcas.length < this.maxPorVentana) {
        this.marcas.push(t);
        return;
      }
      await this.esperar(this.ventanaMs - (t - this.marcas[0]!) + 5);
    }
  }

  /** Ajusta con los headers de GHL: si quedan pocas llamadas en la ventana, pausa. */
  actualizar(cabeceras: Headers): void {
    const restantes = Number(cabeceras.get('x-ratelimit-remaining'));
    const intervalo = Number(cabeceras.get('x-ratelimit-interval-milliseconds')) || this.ventanaMs;
    if (Number.isFinite(restantes) && cabeceras.has('x-ratelimit-remaining') && restantes <= 3) {
      this.pausaHasta = Math.max(this.pausaHasta, this.ahora() + intervalo);
    }
  }

  /** Pausa explícita (p. ej. tras un 429 con Retry-After). */
  pausar(ms: number): void {
    this.pausaHasta = Math.max(this.pausaHasta, this.ahora() + ms);
  }
}

const porSubcuenta = new Map<string, Limitador>();

/** Un limitador compartido por subcuenta dentro del proceso. */
export function limitadorDe(locationId: string, maxPorVentana?: number): Limitador {
  let l = porSubcuenta.get(locationId);
  if (!l) {
    l = new Limitador(maxPorVentana);
    porSubcuenta.set(locationId, l);
  }
  return l;
}
