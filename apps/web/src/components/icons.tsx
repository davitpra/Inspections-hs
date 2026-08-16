/**
 * Los íconos de la consola de programación: decorativos y nada más, `aria-hidden` y sin
 * `title`. Lo que identifica cada bloque es el texto que va al lado — el ícono solo lo
 * hace más rápido de encontrar en un vistazo.
 */

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

export function CalendarIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

export function PersonIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20c1.4-3.7 4.2-5.5 7.5-5.5s6.1 1.8 7.5 5.5" />
    </svg>
  );
}

export function PinIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 21c4.5-4.6 7-7.9 7-11a7 7 0 1 0-14 0c0 3.1 2.5 6.4 7 11Z" />
      <circle cx="12" cy="10" r="2.5" />
    </svg>
  );
}

export function InfoIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.5v.01" />
    </svg>
  );
}

export function GridIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  );
}

export function MoreIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={2.6}>
      <path d="M6 12h.01M12 12h.01M18 12h.01" />
    </svg>
  );
}

export function ListIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3 6h.01M3 12h.01M3 18h.01" />
    </svg>
  );
}
