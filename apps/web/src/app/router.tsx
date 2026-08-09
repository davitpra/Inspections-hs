import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';

import { CaptureRoute } from '../routes/CaptureRoute';
import { OfflineRoute } from '../routes/OfflineRoute';
import { OutboxRoute } from '../routes/OutboxRoute';
import { PendingRoute } from '../routes/PendingRoute';
import { PrepareRoute } from '../routes/PrepareRoute';
import { ReviewRoute } from '../routes/ReviewRoute';
import { SignInRoute } from '../routes/SignInRoute';
import { SessionProvider, useAppSession } from './session-context';

/**
 * ADR-003 — TanStack Router, definido en código y no por archivos.
 *
 * Cinco rutas y todas dentro del shell precacheado. El árbol explícito es también la
 * lista de lo que el service worker tiene que poder servir sin red: un router por
 * convención de archivos escondería esa lista en la estructura de un directorio.
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
]);

export const router = createRouter({ routeTree, defaultPreload: false });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
