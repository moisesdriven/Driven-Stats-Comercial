/** Tramo de horario tal como lo muestra y edita la interfaz. */
export interface TramoUI {
  diaSemana: number;
  inicio: string;
  fin: string;
}

export const aMinutos = (h: string) => {
  const [a, b] = h.split(':').map(Number);
  return (a ?? 0) * 60 + (b ?? 0);
};

/** Horas laborales por semana de un conjunto de tramos. */
export const horasSemana = (tramos: TramoUI[]) =>
  tramos.reduce((t, x) => t + (aMinutos(x.fin) - aMinutos(x.inicio)) / 60, 0);
