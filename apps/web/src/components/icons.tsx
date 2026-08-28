/**
 * Los íconos de la consola de programación: decorativos y nada más, `aria-hidden` y sin
 * `title`. Lo que identifica cada bloque es el texto que va al lado — el ícono solo lo
 * hace más rápido de encontrar en un vistazo.
 */

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

export function CalendarIcon({
  size = 20,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="m9 15 2 2 4-4" />
    </svg>
  );
}

export function PersonIcon({
  size = 18,
}: {
  size?: number;
}): React.JSX.Element {
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

export function ClockIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </svg>
  );
}

export function LockIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function CheckIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  );
}

/*
 * Las cuatro marcas de estado de la matriz de cumplimiento, más `ClockIcon` que ya estaba.
 *
 * Todas dibujan el MISMO círculo de radio 9 y cambian solo lo de adentro: en la matriz la
 * casilla no lleva texto, así que la forma interior es lo que distingue un estado de otro
 * —el color solo lo acompaña— y para eso el marco tiene que ser idéntico en las cinco.
 */
export function CheckCircleIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.75 2.75L16 9.5" />
    </svg>
  );
}

export function MinusCircleIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 12h7" />
    </svg>
  );
}

export function AlertCircleIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.25M12 16.25h.01" />
    </svg>
  );
}

export function CrossCircleIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9.25 9.25 5.5 5.5M14.75 9.25l-5.5 5.5" />
    </svg>
  );
}

/** La bandeja que recibe trabajo desde el servidor. */
export function InboxIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 5h16l1 10H3L4 5Z" />
      <path d="M3 15h5l1.5 2h5L16 15h5M12 8v4M9.5 10.5 12 13l2.5-2.5" />
    </svg>
  );
}

/** La bandeja que espera trabajo para enviar al servidor. */
export function OutboxIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 19h16l1-10H3l1 10Z" />
      <path d="M3 9h5l1.5-2h5L16 9h5M12 16V12M9.5 13.5 12 11l2.5 2.5" />
    </svg>
  );
}

export function PlayIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  );
}

/** Abrir algo aparte de la pantalla en curso — un reporte, un documento. */
export function ExternalLinkIcon({
  size = 16,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M14 5h5v5" />
      <path d="M19 5l-7 7" />
      <path d="M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" />
    </svg>
  );
}

/**
 * El menú de la barra del teléfono. Es el único ícono de este archivo que NO acompaña a un
 * texto: es el contenido entero de un botón, así que quien lo usa pone el `aria-label`
 * —`AppBar` lo hace— y el `aria-hidden` de acá sigue siendo lo correcto, porque el nombre
 * accesible lo da el botón y no el dibujo.
 */
export function MenuIcon({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

/**
 * Cerrar. Como `MenuIcon`, es el contenido entero de un botón y no acompaña a un texto: el
 * nombre accesible lo pone quien lo usa (`Sheet` escribe "Close menu"), no el dibujo.
 */
export function CloseIcon({ size = 24 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/**
 * Sin red. Las ondas tachadas y no una nube: lo que falta es la conexión del dispositivo,
 * no un servicio remoto, y esa distinción es la que hace accionable el aviso — el inspector
 * tiene que buscar señal, no esperar a que alguien arregle algo del otro lado.
 */
export function WifiOffIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M2 4l20 20" />
      <path d="M4.5 9.5A15 15 0 0 1 9 6.9" />
      <path d="M1.5 6A19 19 0 0 1 6 3.2" />
      <path d="M14.5 6.6A15 15 0 0 1 22.5 12" />
      <path d="M7.5 13A9.5 9.5 0 0 1 12 11" />
      <path d="M16.5 13A9.5 9.5 0 0 0 14 11.4" />
      <path d="M10.5 16.5a3 3 0 0 1 3.6.4" />
      <path d="M12 20h.01" />
    </svg>
  );
}

/** La cámara del campo: lo que abre el control de foto, con texto al lado. */
export function CameraIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  );
}

export function SearchIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function UploadIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M7 18H5.5a3.5 3.5 0 0 1-.6-6.95A6.5 6.5 0 0 1 17.5 9.5h.5a3 3 0 0 1 .5 5.96" />
      <path d="M12 12v8M8.75 15.25 12 12l3.25 3.25" />
    </svg>
  );
}

export function PlusIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** La hoja del builder: identifica el encabezado de «Template builder». */
export function DocumentIcon({ size = 20 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </svg>
  );
}

/**
 * El requisito de inspección: una planilla sujeta a una tabla. No es `DocumentIcon` —la
 * hoja suelta es el borrador que se está escribiendo, y esto es la obligación ya fijada
 * que el sitio repite cada período.
 */
export function ClipboardIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M9 4H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2" />
      <rect x="9" y="2" width="6" height="4" rx="1" />
      <path d="m9.5 13.5 2 2 3.5-4" />
    </svg>
  );
}

/**
 * Una planta. Va donde se habla de St. Thomas o Glencoe —el alcance de la plantilla, la
 * ubicación que resuelve en cada una— y NO donde se habla de un lugar dentro de la planta:
 * eso es `PinIcon`, y confundirlos haría que el alcance y la ubicación se lean iguales.
 */
export function BuildingIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 21V6a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v15" />
      <path d="M12 10h7a1 1 0 0 1 1 1v10" />
      <path d="M3 21h18" />
      <path d="M7 9h2M7 13h2M15 14h2M15 17h2" />
    </svg>
  );
}

/** Duplicar: dos hojas, una detrás de la otra. */
/**
 * La configuración de la respuesta. El engranaje y no un lápiz: lo que abre no es editar
 * el texto de la pregunta —eso se hace en el campo de al lado, sin abrir nada— sino los
 * parámetros con los que se responde.
 */
export function GearIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
    </svg>
  );
}

/**
 * Duplicar, no copiar: la hoja detrás de la hoja lleva un «+» encima. Sin él el dibujo es
 * el de «copiar al portapapeles», y en un botón sin texto eso deja al autor esperando un
 * lugar donde pegar algo que en realidad ya quedó creado acá abajo.
 */
export function DuplicateIcon({
  size = 16,
}: {
  size?: number;
}): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
      <path d="M15 12v6M12 15h6" />
    </svg>
  );
}

/** Quitar. El color lo pone la clase del botón, no el ícono. */
export function TrashIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="M4 7h16" />
      <path d="M10 11v6M14 11v6" />
      <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
      <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
    </svg>
  );
}

/**
 * El chevron de plegar. Apunta hacia arriba cuando la sección está abierta, y quien lo usa
 * lo rota por CSS: una sola forma, para que la animación exista sin dos SVG.
 */
export function ChevronIcon({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)}>
      <path d="m6 15 6-6 6 6" />
    </svg>
  );
}

/**
 * La manija de arrastre. Es lo único de este archivo que NO es decorativo del todo: marca
 * dónde agarrar. Aun así va `aria-hidden`, porque el botón que lo envuelve lleva el
 * `aria-label` que lo nombra, y el camino de teclado no es este — es «Move up» / «Move
 * down» en el menú de la fila (ADR-010).
 */
export function GripIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)} strokeWidth={2.4}>
      <path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" />
    </svg>
  );
}

/**
 * La cruz de la marca: la misma forma del favicon y del icono instalado
 * (`public/icon-192.png`), para que la aplicación se llame igual en la pestaña, en el
 * escritorio del teléfono y arriba de «Health & Safety».
 *
 * Es la única de este archivo que se dibuja rellena y no trazada: el resto son íconos de
 * línea que acompañan un texto, y esta es una marca — a 16px un trazo de 1.8 la deja
 * flaca y deja de leerse como la del ícono instalado.
 */
export function CrossIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg {...svgProps(size)} stroke="none" fill="currentColor">
      <path d="M9.2 4h5.6v5.2H20v5.6h-5.2V20H9.2v-5.2H4V9.2h5.2V4Z" />
    </svg>
  );
}
