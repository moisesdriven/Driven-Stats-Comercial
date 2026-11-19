/** Íconos del diseño (trazos SVG). Siempre decorativos: el texto acompaña. */
const base = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const IconoGeneral = () => (
  <svg {...base}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </svg>
);
export const IconoSubcuenta = () => (
  <svg {...base}>
    <path d="M3 21h18" />
    <path d="M5 21V7l7-4 7 4v14" />
    <path d="M9 21v-6h6v6" />
  </svg>
);
export const IconoAsesor = () => (
  <svg {...base}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4 4-6 8-6s8 2 8 6" />
  </svg>
);
/** El color va por `style` para aceptar variables del tema (var(--…)) en los dos temas. */
const conColor = (color?: string) => (color ? { color } : undefined);

export const IconoReloj = ({ tam = 18, color }: { tam?: number; color?: string }) => (
  <svg {...base} width={tam} height={tam} style={conColor(color)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
export const IconoEscudo = () => (
  <svg {...base}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </svg>
);
export const IconoEngranaje = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
);
export const IconoMetas = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1" />
  </svg>
);
export const IconoTendencia = () => (
  <svg {...base} width={18} height={18} stroke="#FFFFFF" strokeWidth={2.2}>
    <path d="M3 17l6-6 4 4 8-8" />
    <path d="M14 7h7v7" />
  </svg>
);
export const IconoAlerta = ({ color, tam = 18 }: { color?: string; tam?: number }) => (
  <svg {...base} width={tam} height={tam} style={conColor(color)}>
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" />
  </svg>
);
export const IconoExterno = () => (
  <svg {...base} width={14} height={14}>
    <path d="M7 17L17 7" />
    <path d="M8 7h9v9" />
  </svg>
);
export const IconoMensaje = () => (
  <svg {...base} width={15} height={15}>
    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
  </svg>
);
export const IconoCerrar = () => (
  <svg {...base}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
);
export const IconoMas = () => (
  <svg {...base} width={16} height={16} strokeWidth={2.2}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
);
export const IconoCheck = ({ color, tam = 12 }: { color?: string; tam?: number }) => (
  <svg {...base} width={tam} height={tam} style={conColor(color)} strokeWidth={3.2}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);
export const IconoBuscar = () => (
  <svg {...base} width={16} height={16}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
);

export const IconoCirculoCheck = ({ tam = 15 }: { tam?: number }) => (
  <svg {...base} width={tam} height={tam}>
    <circle cx="12" cy="12" r="9" />
    <path d="m8 12 3 3 5-6" />
  </svg>
);
export const IconoInfo = ({ tam = 15 }: { tam?: number }) => (
  <svg {...base} width={tam} height={tam}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);
export const IconoDescarga = () => (
  <svg {...base}>
    <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
  </svg>
);
export const IconoCalendario = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 11h18" />
  </svg>
);
export const IconoFlecha = ({ dir }: { dir: 'izq' | 'der' | 'abajo' }) => (
  <svg {...base} width={16} height={16}>
    <path d={dir === 'izq' ? 'M15 6l-6 6 6 6' : dir === 'der' ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} />
  </svg>
);
export const IconoHamburguesa = () => (
  <svg {...base}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const IconoContraer = ({ abierto }: { abierto: boolean }) => (
  <svg {...base}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
    <path d={abierto ? 'M16 10l-2 2 2 2' : 'M14 10l2 2-2 2'} />
  </svg>
);
export const IconoSol = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const IconoLuna = () => (
  <svg {...base}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);
