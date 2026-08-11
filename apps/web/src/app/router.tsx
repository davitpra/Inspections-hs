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
import { RecurrenceRoute } from '../routes/RecurrenceRoute';
import { ReportIncidentRoute } from '../routes/ReportIncidentRoute';
import { ReviewRoute } from '../routes/ReviewRoute';
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
  actionsRoute,
  actionRoute,
  incidentsRoute,
  reportIncidentRoute,
  incidentRoute,
  form7Route,
  recurrenceRoute,
  inboxRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
