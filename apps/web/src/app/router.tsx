import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { ActionRoute } from '../routes/ActionRoute';
import { ActionsRoute } from '../routes/ActionsRoute';
import { CaptureRoute } from '../routes/CaptureRoute';
import { Form7Route } from '../routes/Form7Route';
import { InboxRoute } from '../routes/InboxRoute';
import { IncidentRoute } from '../routes/IncidentRoute';
import { IncidentsRoute } from '../routes/IncidentsRoute';
import { OfflineRoute } from '../routes/OfflineRoute';
import { OutboxRoute } from '../routes/OutboxRoute';
import { PendingRoute } from '../routes/PendingRoute';
import { PrepareRoute } from '../routes/PrepareRoute';
import { ComplianceRoute } from '../routes/ComplianceRoute';
import { RecurrenceRoute } from '../routes/RecurrenceRoute';
import { ReportIncidentRoute } from '../routes/ReportIncidentRoute';
import { ReviewRoute } from '../routes/ReviewRoute';
import { SchedulingRoute } from '../routes/SchedulingRoute';
import { SignInRoute } from '../routes/SignInRoute';
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
 * El marco, y la única puerta: sin cuenta no se entra a ninguna pantalla de captura.
 *
 * **La comprobación es contra la cuenta GUARDADA, no contra la red.** El inspector
 * abre la aplicación en una planta sin señal y tiene que entrar igual: `refreshAccount`
 * devuelve lo último que se supo cuando no hay conexión, y eso alcanza para saber de
 * quién es el borrador. Pedir login al perder la señal sería perder el recorrido.
 */
function Shell(): React.JSX.Element {
  const { account, ready, signOut } = useAppSession();

  if (!ready) return <div className="shell__main">Loading…</div>;

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
          EL PRIMER LINK CONDICIONADO POR ROL de esta barra, y queda escrito para que se
          lea como precedente y no como descuido. Solo el coordinador administra la
          programación, así que ofrecérsela al resto sería ofrecer una pantalla sin
          controles. La ruta sigue siendo alcanzable por URL y se renderiza de solo
          lectura: los GET no comprueban rol y RLS ya recorta lo que se ve.
        */}
        {account.role === 'hs_coordinator' ? <Link to="/scheduling">Scheduling</Link> : null}
        <Link to="/inbox">Inbox</Link>
        <Link to="/outbox">Waiting to be sent</Link>
        <button type="button" className="shell__signout" onClick={() => void signOut()}>
          Sign out
        </button>
      </nav>

      <main className="shell__main">
        <Outlet />
      </main>
    </div>
  );
}

const pendingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: PendingRoute,
});

const prepareRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspections/$id/prepare',
  component: PrepareRoute,
});

const captureRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inspections/$id/capture',
  component: CaptureRoute,
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
  prepareRoute,
  captureRoute,
  reviewRoute,
  outboxRoute,
  schedulingRoute,
  actionsRoute,
  actionRoute,
  incidentsRoute,
  reportIncidentRoute,
  incidentRoute,
  form7Route,
  recurrenceRoute,
  complianceRoute,
  inboxRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
