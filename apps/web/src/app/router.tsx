import {
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  useRouterState,
} from '@tanstack/react-router';
import { z } from 'zod';

import { AcceptInvitationRoute } from '../routes/AcceptInvitationRoute';
import { ActionRoute } from '../routes/ActionRoute';
import { ActionsRoute } from '../routes/ActionsRoute';
import { CaptureRoute } from '../routes/CaptureRoute';
import { Form7Route } from '../routes/Form7Route';
import { InboxRoute } from '../routes/InboxRoute';
import { InspectionReportRoute } from '../routes/InspectionReportRoute';
import { InspectorHomeRoute } from '../routes/InspectorHomeRoute';
import { IncidentRoute } from '../routes/IncidentRoute';
import { IncidentsRoute } from '../routes/IncidentsRoute';
import { OfflineRoute } from '../routes/OfflineRoute';
import { OutboxRoute } from '../routes/OutboxRoute';
import { PastInspectionsRoute } from '../routes/PastInspectionsRoute';
import { RecurrenceRoute } from '../routes/RecurrenceRoute';
import { ReportIncidentRoute } from '../routes/ReportIncidentRoute';
import { ReviewRoute } from '../routes/ReviewRoute';
import { RosterRoute } from '../routes/RosterRoute';
import { SchedulingRoute } from '../routes/SchedulingRoute';
import { ScheduleRequirementRoute } from '../routes/ScheduleRequirementRoute';
import { SignInRoute } from '../routes/SignInRoute';
import { TemplateDraftRoute } from '../routes/TemplateDraftRoute';
import { TemplatesRoute } from '../routes/TemplatesRoute';
import { PublishedTemplateRoute } from '../routes/PublishedTemplateRoute';
import { LocationsRoute } from '../routes/LocationsRoute';
import { AppBar } from './AppBar';
import { SessionProvider, useAppSession } from './session-context';
import { Sidebar } from './Sidebar';

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
      <div className="shell shell--plain">
        <main className="shell__main">
          <Outlet />
        </main>
      </div>
    );
  }

  if (!account) {
    return (
      <div className="shell shell--plain">
        <main className="shell__main">
          <SignInRoute />
        </main>
      </div>
    );
  }

  return (
    <div className="shell">
      {/*
         DOS BARRAS, UNA SOLA VISIBLE, Y ES CSS EL QUE ELIGE (ver `.sidebar` y `.appbar`).
         Las dos se montan siempre y no se conmutan con un `matchMedia` en JavaScript: el
         ancho de la ventana no es estado de la aplicación, y una barra que se monta y se
         desmonta al girar el teléfono perdería el foco del teclado en el giro.

         Arriba de 48rem, el sidebar queda en su propia columna y mantiene los destinos a la
         vista con el actual marcado por forma, sin quitarle alto vertical al contenido.

          Debajo, `AppBar`: menú, título y cuenta. El porqué de que no sean las mismas pestañas
          achicadas está escrito en `AppBar.tsx`, junto al componente que lo resuelve.

         El sidebar sí puede ser `position: sticky`: al ocupar su propia columna no compite con
         `.unsynced`, que se pega con `z-index: 10` dentro de `.shell__main`.
       */}
      <Sidebar account={account} onSignOut={() => void signOut()} />

      <AppBar account={account} pathname={pathname} onSignOut={() => void signOut()} />

      {/* Un solo ancho para todas las rutas; el porqué está en `.shell__main`. */}
      <main className="shell__main">
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
const inspectorHomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  validateSearch: z.object({ submitted: z.literal('accepted').optional() }),
  component: InspectorHomeRoute,
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
/**
 * La consola de programación (§4). ONLINE y fuera del precacheo del service worker, por
   * lo mismo que la recurrencia —se planifica sentado— y por una razón
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

const scheduleRequirementRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/scheduling/$scheduleId',
  component: ScheduleRequirementRoute,
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

/**
 * La autoría de plantillas (§7 etapa 8). ONLINE y fuera del precacheo, por lo mismo que
 * `/scheduling` y `/roster` —se escribe sentado— y por una razón propia: un borrador servido
 * desde caché sería un documento viejo sobre el que alguien seguiría escribiendo, y el lock
 * de revisión rechazaría cada guardado sin que se entienda por qué.
 *
 * **`/templates` y no `/inspections/templates`**: `CAPTURE_ROUTES` en `sw.ts` matchea
 * `/^\/inspections\//`, así que colgarla de ese prefijo la metería sin querer en el shell
 * precacheado. Es la misma trampa que documentan `schedulingRoute` y `rosterRoute`.
 */
const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  component: TemplatesRoute,
});

// Dos segmentos más que `/templates`, así que no compiten; se declara después igual, por el
// mismo orden de lo general a lo específico que sigue el resto del árbol.
const templateDraftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/drafts/$id',
  component: TemplateDraftRoute,
});

const publishedTemplateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/versions/$versionId',
  component: PublishedTemplateRoute,
});

const locationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/catalog/locations',
  component: LocationsRoute,
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
  inspectorHomeRoute,
  captureRoute,
  pastInspectionsRoute,
  inspectionReportRoute,
  reviewRoute,
  outboxRoute,
  schedulingRoute,
  scheduleRequirementRoute,
  rosterRoute,
  templatesRoute,
  templateDraftRoute,
  publishedTemplateRoute,
  locationsRoute,
  actionsRoute,
  actionRoute,
  incidentsRoute,
  reportIncidentRoute,
  incidentRoute,
  form7Route,
  recurrenceRoute,
  inboxRoute,
  acceptInvitationRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
