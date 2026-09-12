import type { Session } from '@hs/contracts';

import {
  AlertCircleIcon,
  CalendarIcon,
  ClipboardIcon,
  DocumentIcon,
  ListIcon,
  OutboxIcon,
  PersonIcon,
  PinIcon,
} from '../components/icons';
import {
  canAdministerRoster,
  canAdministerCatalog,
  canAdministerScheduling,
  canAuthorTemplates,
} from '../permissions/session';

/**
 * A dónde se puede ir, en un solo lugar.
 *
 * Existe porque la misma lista se dibuja DOS veces —las pestañas del escritorio y el menú
 * del teléfono— y dos listas escritas a mano se separan en el primer destino nuevo: el
 * síntoma sería un link que existe en una pantalla ancha y no en un teléfono, que es
 * exactamente el dispositivo desde el que se usa la aplicación en la planta.
 *
 * No es el árbol de rutas. Acá están las que se OFRECEN; `router.tsx` tiene las que se
 * pueden alcanzar, que son más (la captura, el reporte o un incidente) y a las
 * que se llega desde la pantalla que las nombra.
 */

/**
 * Los destinos escritos como un tipo y no como `string`: `<Link to={…}>` de TanStack acepta
 * las rutas del árbol y nada más, así que un path mal escrito acá no compila, ni en las
 * pestañas ni en el menú. Es la lista de arriba, en tipo — y la de abajo no puede tener
 * ninguno que no esté acá.
 */
export type NavPath =
  | '/'
  | '/historical'
  | '/findings'
  | '/scheduling'
  | '/roster'
  | '/templates'
  | '/catalog/locations'
  | '/outbox';

export type NavIcon = (props: { size?: number }) => React.JSX.Element;

export type NavItem = {
  readonly to: NavPath;
  readonly label: string;
  /** El icono del destino. Evita que la navegación ancha mantenga una lista separada. */
  readonly icon: NavIcon;
  /** Sin `visible`, el destino es de todos. */
  readonly visible?: (account: Session) => boolean;
};

/**
 * LOS DESTINOS CONDICIONADOS POR ROL. Los dos roles administrativos gestionan la programación,
 * el roster, las plantillas y el catálogo; ofrecérselos al miembro sería ofrecer una pantalla sin
 * controles.
 *
 * **Y no se condicionan igual por dentro**, que es lo que conviene leer acá:
 *
 *   - `/scheduling` sigue siendo alcanzable por URL y se renderiza de solo lectura; sus GET
 *     no comprueban rol y RLS ya recorta lo que se ve. Que un miembro del JHSC vea la
 *     programación de su planta es legítimo.
 *   - `/roster` NO. Ahí el rol se comprueba también en la lectura, en el cliente y en el
 *     servidor: §4 dice que se elige a una persona sin poder ver su perfil, y un roster de
 *     solo lectura para un miembro del JHSC sería exactamente esa ficha.
 *   - `/templates` tampoco. El servidor contesta `template_draft_forbidden` en las cinco
 *     rutas de borrador, el GET incluido: una plantilla a medio pensar son preguntas que la
 *     organización todavía no decidió hacer.
 *
 * O sea: el link ausente es una comodidad en los dos casos, pero la garantía solo la hay en
 * el segundo, y está del lado del servidor.
 *
 * Las dos condiciones son las MISMAS funciones que usan las dos pantallas, y por eso son dos
 * y no una: hoy preguntan lo mismo, pero un link que se ofrece y una pantalla que se niega
 * serían el peor de los desacuerdos posibles.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', label: 'Inspections', icon: ListIcon },
  { to: '/historical', label: 'Historical inspections', icon: ClipboardIcon },
  { to: '/findings', label: 'Findings', icon: AlertCircleIcon },
  {
    to: '/scheduling',
    label: 'Scheduling',
    icon: CalendarIcon,
    visible: canAdministerScheduling,
  },
  { to: '/roster', label: 'People', icon: PersonIcon, visible: canAdministerRoster },
  { to: '/templates', label: 'Templates', icon: DocumentIcon, visible: canAuthorTemplates },
  {
    to: '/catalog/locations',
    label: 'Locations',
    icon: PinIcon,
    visible: canAdministerCatalog,
  },
  { to: '/outbox', label: 'Waiting to be sent', icon: OutboxIcon },
];

export function visibleNavItems(account: Session): readonly NavItem[] {
  return NAV_ITEMS.filter((item) => !item.visible || item.visible(account));
}

/**
 * Cómo se llama la pantalla que se está mirando, para el título de la barra del teléfono.
 *
 * Cubre TODAS las rutas y no solo las del menú: en el teléfono el título es lo único
 * que dice dónde se está —no hay una pestaña subrayada—, y las pantallas a las que se llega
 * desde otra (la captura, la revisión, un incidente) son justamente en las que uno se mete
 * dos niveles y necesita leerlo.
 *
 * `*` es un segmento cualquiera —un id—, y el orden importa: gana el primer patrón que
 * coincide, así que lo específico va antes que el comodín (`/incidents/report` antes que
 * `/incidents/*`), igual que en el árbol de rutas.
 */
const TITLES: readonly (readonly [string, string])[] = [
  ['/', 'Inspections'],
  ['/historical', 'Historical inspections'],
  ['/inspections/*/capture', 'Inspection'],
  ['/inspections/*/review', 'Review'],
  ['/inspections/*/report', 'Inspection report'],
  ['/inspections/*', 'Inspection'],
  ['/findings', 'Findings'],
  ['/findings/*', 'Inspection findings'],
  ['/incidents', 'Incidents'],
  ['/incidents/report', 'Report an incident'],
  ['/incidents/*/form7', 'Form 7'],
  ['/incidents/*', 'Incident'],
  ['/scheduling', 'Scheduling'],
  ['/roster', 'People'],
  ['/templates', 'Templates'],
  ['/templates/drafts/*', 'Template'],
  ['/catalog/locations', 'Locations'],
  ['/outbox', 'Waiting to be sent'],
  ['/accept-invitation', 'Accept invitation'],
];

function matches(pattern: string, segments: readonly string[]): boolean {
  const expected = pattern.split('/').filter(Boolean);

  if (expected.length !== segments.length) return false;

  return expected.every((part, index) => part === '*' || part === segments[index]);
}

/**
 * El nombre de la pantalla, o el de la aplicación cuando la URL no es ninguna conocida
 * —que es el caso de `notFoundComponent`—. Nunca vacío: un título en blanco dejaría la
 * barra con dos botones y un hueco en el medio.
 */
export function sectionTitle(pathname: string): string {
  const segments = pathname.split('/').filter(Boolean);
  const found = TITLES.find(([pattern]) => matches(pattern, segments));

  return found ? found[1] : 'Health & Safety';
}
