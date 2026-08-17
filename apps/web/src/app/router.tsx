import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router';
import { z } from 'zod';

import { AccountChip } from '../components/AccountChip';
import { AcceptInvitationRoute } from '../routes/AcceptInvitationRoute';
import { ActionRoute } from '../routes/ActionRoute';
import { ActionsRoute } from '../routes/ActionsRoute';
import { CaptureRoute } from '../routes/CaptureRoute';
import { Form7Route } from '../routes/Form7Route';
import { InboxRoute } from '../routes/InboxRoute';
import { InspectionReportRoute } from '../routes/InspectionReportRoute';
import { IncidentRoute } from '../routes/IncidentRoute';
import { IncidentsRoute } from '../routes/IncidentsRoute';
import { OfflineRoute } from '../routes/OfflineRoute';
import { OutboxRoute } from '../routes/OutboxRoute';
import { PastInspectionsRoute } from '../routes/PastInspectionsRoute';
import { PendingRoute } from '../routes/PendingRoute';
import { ComplianceRoute } from '../routes/ComplianceRoute';
import { RecurrenceRoute } from '../routes/RecurrenceRoute';
import { ReportIncidentRoute } from '../routes/ReportIncidentRoute';
import { ReviewRoute } from '../routes/ReviewRoute';
import { RosterRoute } from '../routes/RosterRoute';
import { SchedulingRoute } from '../routes/SchedulingRoute';
import { SignInRoute } from '../routes/SignInRoute';
import { canAdministerRoster, canAdministerScheduling } from '../permissions/session';
import { SessionProvider, useAppSession } from './session-context';

/**
 * ADR-003 — TanStack Router, definido en código y no por archivos.
 *
 * El árbol explícito es también la lista de lo que el service worker tiene que poder
 * servir sin red: un router por convención de archivos escondería esa lista en la
 * estructura de un directorio.
 *
 * Las rutas de la etapa 5 —acciones correctivas y bandeja— son ONLINE (design D15) y no
 * dependen del precacheo para funcionar: una acción se ejecuta con red. Están en el
 * mismo shell porque son la misma aplicación, no porque necesiten estar sin señal.
 *
 * Las de la etapa 6 —incidentes— también son online, y por un motivo propio (design D14):
 * un accidente se reporta desde una oficina o un teléfono con señal, y un reporte
 * esperando sincronización sería invisible para todos mientras los plazos del MLITSD ya
 * corren desde el momento del evento.
 */

const rootRoute = createRootRoute({
  component: () => (
    <SessionProvider>
      <Shell />
    </SessionProvider>
  ),
  // Cualquier ruta fuera del shell cae acá y NO descarta nada.
  notFoundComponent: OfflineRoute,
});

/**
 * Las rutas que se renderizan SIN cuenta. Es una lista y no un `if` suelto porque
 * `/accept-invitation` es la primera pero no va a ser la última, y porque lo que hay que
 * poder leer de un vistazo es exactamente qué queda afuera de la puerta.
 *
 * Todo lo que entre acá tiene que poder justificarse igual que esta: quien la abre no
 * puede tener sesión todavía —su credencial ES el token de la invitación—, así que
 * pedirle login sería pedirle lo que viene a conseguir.
 */
const PUBLIC_ROUTES = ['/accept-invitation'];

/**
 * Las rutas que NO se leen con medida de lectura.
 *
 * `.shell__main` mide 46rem porque casi todo acá es texto y un renglón largo se lee peor.
 * La consola de programación no es texto: es un calendario de doce meses, y a 46rem entran
 * dos columnas, así que diciembre queda a seis filas de scroll de enero. El año completo
 * de un vistazo ES la pantalla, y por eso esta ruta pide más ancho.
 *
 * `/` por el mismo motivo, con su propia forma: la asignación destacada es contenido
 * principal (progreso, secciones) más una columna de preparación (antes de empezar,
 * información de sitio, historial) al lado, y a 46rem esa segunda columna cae siempre —
 * `.assignment__layout` recién tiene dónde poner las dos a partir de ~58rem.
 *
 * Es una lista y no un `if` por lo mismo que `PUBLIC_ROUTES`: lo que hay que poder leer de
 * un vistazo es exactamente cuáles se salen de la medida, y cada una tiene que justificarlo.
 */
const WIDE_ROUTES = ['/', '/scheduling'];

/**
 * El marco, y la única puerta: sin cuenta no se entra a ninguna pantalla de captura.
 *
 * **La comprobación es contra la cuenta GUARDADA, no contra la red.** El inspector
 * abre la aplicación en una planta sin señal y tiene que entrar igual: `refreshAccount`
 * devuelve lo último que se supo cuando no hay conexión, y eso alcanza para saber de
 * quién es el borrador. Pedir login al perder la señal sería perder el recorrido.
 */
function Shell(): React.JSX.Element {
  const { account, ready, signOut } = useAppSession();
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  if (!ready) return <div className="shell__main">Loading…</div>;

  // Antes de la comprobación de cuenta, y sin barra de navegación: quien llega acá
  // todavía no tiene a dónde navegar.
  if (PUBLIC_ROUTES.includes(pathname)) {
    return (
      <div className="shell">
        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="shell">
        <main className="shell__main">
          <SignInRoute />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      <nav className="shell__nav">
        <Link to="/">Inspections</Link>
        <Link to="/actions">Corrective actions</Link>
        <Link to="/recurrence">Recurring findings</Link>
        <Link to="/compliance">Compliance</Link>
        {/*
          LOS DOS LINKS CONDICIONADOS POR ROL de esta barra. Solo el coordinador administra
          la programación y el roster, así que ofrecérselas al resto sería ofrecer una
          pantalla sin controles.

          **Y no se condicionan igual por dentro**, que es lo que conviene leer acá:

            - `/scheduling` sigue siendo alcanzable por URL y se renderiza de solo lectura;
              sus GET no comprueban rol y RLS ya recorta lo que se ve. Que un miembro del
              JHSC vea la programación de su planta es legítimo.
            - `/roster` NO. Ahí el rol se comprueba también en la lectura, en el cliente y
              en el servidor: §4 dice que se elige a una persona sin poder ver su perfil, y
              un roster de solo lectura para un supervisor sería exactamente esa ficha.

          O sea: el link ausente es una comodidad en los dos casos, pero la garantía solo
          la hay en el segundo, y está del lado del servidor.

          Las dos condiciones son las MISMAS funciones que usan las dos pantallas, y por
          eso son dos y no una: hoy preguntan lo mismo, pero un link que se ofrece y una
          pantalla que se niega serían el peor de los desacuerdos posibles.
        */}
        {canAdministerScheduling(account) ? <Link to="/scheduling">Scheduling</Link> : null}
        {canAdministerRoster(account) ? <Link to="/roster">Roster</Link> : null}
        <Link to="/inbox">Inbox</Link>
        <Link to="/outbox">Waiting to be sent</Link>
        {/*
          El chip y "Sign out" quedan juntos al final de la barra: el `margin-left: auto`
          que empujaba al botón pasó al chip, que ahora es el primero del par.
        */}
        <AccountChip account={account} />
        <button type="button" className="shell__signout" onClick={() => void signOut()}>
          Sign out
        </button>
      </nav>

      <main
        className={
          WIDE_ROUTES.includes(pathname) ? 'shell__main shell__main--wide' : 'shell__main'
        }
      >
        <Outlet />
      </main>
    </div>
  );
}

/**
 * La pantalla de inicio, y el destino de una inspección que el servidor YA aceptó.
 *
 * `submitted` es opcional y no identifica nada: es el acuse de la acción anterior, no un
 * recurso. Va en el search y no en el path por eso mismo —igual que el token de
 * `/accept-invitation`— y `validateSearch` deja que la pantalla lo reciba tipado. Una URL
 * pegada a mano con el parámetro puesto muestra un aviso de más y nada peor.
 */
const pendingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: z.object({ submitted: z.literal('accepted').optional() }),
  component: PendingRoute,
});

/**
 * La captura, y su MODO de solo lectura.
 *
 * `preview` va en el search y no en el path porque no identifica otro recurso: es la misma
 * inspección, mirada sin tocarla. La pantalla corta hacia la vista previa antes de tocar el
 * dispositivo, así que abrir esto no crea un borrador ni descarga nada (ADR-001).
 *
 * `z.literal('1')` y no un booleano suelto: un valor escrito a mano que no sea exactamente
 * ese se ignora y la URL abre la captura de siempre.
 */
const captureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspections/$id/capture',
  validateSearch: z.object({ preview: z.literal('1').optional() }),
  component: CaptureRoute,
});

/**
 * Una inspección enviada, leída de vuelta. Mismo `$id` que la captura y la revisión —la
 * inspección programada—, así que las tres pantallas de una inspección se direccionan igual.
 */
const inspectionReportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspections/$id/report',
  component: InspectionReportRoute,
});

/**
 * El historial. Un solo segmento bajo `/inspections`, así que no compite con
 * `/inspections/$id/capture`, que tiene tres.
 *
 * No entra a la barra de navegación: se llega desde el pie de "Recent inspections", en la
 * pantalla de inicio, que es donde la pregunta aparece.
 */
const pastInspectionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspections/past',
  component: PastInspectionsRoute,
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspections/$id/review',
  component: ReviewRoute,
});

const actionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/actions',
  component: ActionsRoute,
});

const actionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/actions/$id',
  component: ActionRoute,
});

const incidentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/incidents',
  component: IncidentsRoute,
});

// Antes que `/incidents/$id`: si no, `report` se leería como un id.
const reportIncidentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/incidents/report',
  component: ReportIncidentRoute,
});

const incidentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/incidents/$id',
  component: IncidentRoute,
});

const form7Route = createRoute({
  getParentRoute: () => rootRoute,
  path: '/incidents/$id/form7',
  component: Form7Route,
});

/**
 * La recurrencia (etapa 7). ONLINE y de solo lectura: no entra al precacheo del service
 * worker — se mira sentado, no en 48 acres sin cobertura.
 */
const recurrenceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/recurrence',
  component: RecurrenceRoute,
});

/**
 * El cumplimiento (etapa 7, §3 R5). ONLINE y fuera del precacheo del service worker, por
 * lo mismo que la recurrencia: un reporte regulatorio se genera sentado y con conexión.
 * Guardarlo offline guardaría además una copia de un payload cuyo digest nadie recomputó.
 */
const complianceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/compliance',
  component: ComplianceRoute,
});

/**
 * La consola de programación (§4). ONLINE y fuera del precacheo del service worker, por
 * lo mismo que la recurrencia y el cumplimiento —se planifica sentado— y por una razón
 * propia y más fuerte: una asignación en cola sería un inspector que no sabe que fue
 * asignado. El offline existe para que no se pierda el trabajo de campo, no para diferir
 * decisiones de coordinación.
 *
 * **`/scheduling` y no `/inspections/schedule`**: `CAPTURE_ROUTES` en `sw.ts` matchea
 * `/^\/inspections\//`, así que colgarla de ese prefijo la metería sin querer en el shell
 * precacheado y la haría "disponible" sin red, mostrando datos que no puede traer.
 */
const schedulingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scheduling',
  component: SchedulingRoute,
});

/**
 * La consola del roster (§6 — "el coordinador administra plantillas y roster"). ONLINE y
 * fuera del precacheo, por las dos razones de siempre y una propia: **una baja en cola es
 * una persona que sigue apareciendo en el selector del dispositivo de otro.**
 *
 * **`/roster` y no `/inspections/roster`**: `CAPTURE_ROUTES` en `sw.ts` matchea
 * `/^\/inspections\//`, así que colgarla de ese prefijo la metería sin querer en el shell
 * precacheado y la haría "disponible" sin red, mostrando datos que no puede traer. Es la
 * misma trampa que documenta `schedulingRoute` acá arriba.
 */
const rosterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/roster',
  component: RosterRoute,
});

/**
 * Aceptar una invitación (ADR-011). La única ruta PÚBLICA del árbol — ver `PUBLIC_ROUTES`.
 *
 * ONLINE y fuera del precacheo: es la llamada que CREA la credencial, así que servirla sin
 * red sería servir un formulario que no puede terminar. `CAPTURE_ROUTES` en `sw.ts` matchea
 * `/`, `/inspections/…` y `/outbox`, y este path no cae en ninguno.
 *
 * **El token va en el search y no en el path**: no es el identificador de un recurso, es un
 * secreto de un solo uso, y `validateSearch` deja que la pantalla lo reciba ya tipado en
 * vez de leer `location.search` a mano. Es opcional a propósito — sin él la pantalla pide
 * que se pegue.
 */
const acceptInvitationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accept-invitation',
  validateSearch: z.object({ token: z.string().optional() }),
  component: AcceptInvitationRoute,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxRoute,
});

const outboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/outbox',
  component: OutboxRoute,
});

const routeTree = rootRoute.addChildren([
  pendingRoute,
  captureRoute,
  pastInspectionsRoute,
  inspectionReportRoute,
  reviewRoute,
  outboxRoute,
  schedulingRoute,
  rosterRoute,
  actionsRoute,
  actionRoute,
  incidentsRoute,
  reportIncidentRoute,
  incidentRoute,
  form7Route,
  recurrenceRoute,
  complianceRoute,
  inboxRoute,
  acceptInvitationRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
