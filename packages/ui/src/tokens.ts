/** Tokens de diseño aprobados (ESPECIFICACION.md §10.3). */
export const colores = {
  primario: '#1F5BFF',
  primarioHover: '#0B3FD9',
  primarioClaro: '#4D7CFF',
  primarioSuave: '#E8EEFF',
  texto: '#0B0D12',
  textoSecundario: '#5B6475',
  textoSobreOscuro: '#FFFFFF',
  textoSecundarioSobreOscuro: '#B4BCCC',
  borde: '#E3E8F2',
  bordeFila: '#EDF0F6',
  verde: { base: '#12B76A', fondo: '#E7F8EF', texto: '#067647' },
  amarillo: { base: '#F79009', fondo: '#FEF3E2', texto: '#93370D' },
  rojo: { base: '#F04438', fondo: '#FDECEA', texto: '#B42318' },
} as const;

export const degradados = {
  negro: 'linear-gradient(180deg, #0B0D12 0%, #1B2030 100%)',
  negroTarjeta: 'linear-gradient(135deg, #0B0D12 0%, #1B2030 100%)',
  blanco: 'linear-gradient(180deg, #FFFFFF 0%, #EEF2F9 100%)',
  blancoTarjeta: 'linear-gradient(180deg, #FFFFFF 0%, #F7F9FD 100%)',
} as const;

export const radios = { boton: 10, tarjeta: 16, seccion: 20, pildora: 999 } as const;

export const tipografia = {
  titulos: "'Space Grotesk', Inter, system-ui, sans-serif",
  texto: 'Inter, system-ui, sans-serif',
} as const;
