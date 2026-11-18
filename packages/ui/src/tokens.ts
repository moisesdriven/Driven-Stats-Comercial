/**
 * Tokens de diseño (rediseño aprobado el 18 nov 2026): los colores de Driven de siempre (azul
 * #1F5BFF, negro azulado #0B0D12 y blanco) en pares claro/oscuro con contraste verificado
 * (texto ≥ 4,5:1, íconos y bordes ≥ 3:1). La web los usa como variables CSS en `globales.css`.
 */
export interface ParColor {
  claro: string;
  oscuro: string;
}

export const colores = {
  primario: '#1F5BFF',
  fondo: { claro: '#F3F5FA', oscuro: '#0B0D12' },
  superficie: { claro: '#FFFFFF', oscuro: '#131722' },
  superficieSuave: { claro: '#EEF2F9', oscuro: '#1B2030' },
  texto: { claro: '#0B0D12', oscuro: '#F5F7FB' },
  textoSecundario: { claro: '#535C6E', oscuro: '#B4BCCC' },
  borde: { claro: '#E3E8F2', oscuro: '#262B38' },
  control: { claro: '#8590A6', oscuro: '#687187' },
  marca: { claro: '#1F5BFF', oscuro: '#7C9DFF' },
  marcaSuave: { claro: '#E8EEFF', oscuro: '#1A2547' },
  verde: {
    texto: { claro: '#067647', oscuro: '#4ADE9A' },
    fondo: { claro: '#E3F6EC', oscuro: '#0D2A1D' },
  },
  amarillo: {
    texto: { claro: '#93370D', oscuro: '#FDBA5A' },
    fondo: { claro: '#FEF0DC', oscuro: '#33240C' },
  },
  rojo: {
    texto: { claro: '#B42318', oscuro: '#FF8A80' },
    fondo: { claro: '#FDEAE8', oscuro: '#3A1517' },
  },
} as const;

export const degradados = {
  negro: 'linear-gradient(180deg, #0B0D12 0%, #1B2030 100%)',
  negroTarjeta: 'linear-gradient(135deg, #0B0D12 0%, #1B2030 100%)',
} as const;

export const radios = { boton: 10, tarjeta: 14, seccion: 16, pildora: 999 } as const;

export const tipografia = {
  titulos: 'Sora, Inter, system-ui, sans-serif',
  texto: 'Inter, system-ui, sans-serif',
} as const;
