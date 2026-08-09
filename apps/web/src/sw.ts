/// <reference lib="webworker" />
import { Serwist, type PrecacheEntry } from 'serwist';

/**
 * Design D1 — El service worker, escrito a mano.
 *
 * `injectManifest` y no `generateSW`: la lista de precache la inyecta `@serwist/vite`
 * en `self.__SW_MANIFEST`, pero el comportamiento es de acá. La pieza más importante
 * del change no puede vivir detrás de una capa de configuración.
 *
 * LO QUE ESTE ARCHIVO GARANTIZA: abrir, navegar y completar una inspección no requiere
 * una sola petición de red. El shell —documento, scripts, estilos y el bundle de
 * `@hs/forms`— se precachea en la instalación, con red, y de ahí en adelante las rutas
 * de captura se sirven de esa caché sin tocar la red ni siquiera para revalidar.
 *
 * LO QUE ESTE ARCHIVO NO HACE (D2): enviar. El outbox corre en la ventana, porque
 * garantizar "un solo envío en vuelo" es más fácil en un contexto que en dos. Sin
 * Background Sync: soporte desigual, y con el supuesto de 7 días de ADR-010 aporta poco
 * frente al indicador permanente.
 */

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: (PrecacheEntry | string)[];
};

/**
 * Las rutas de captura. Todas se sirven del `index.html` precacheado: es una SPA, y el
 * documento es el mismo para las cinco.
 */
const CAPTURE_ROUTES = [/^\/$/, /^\/inspections\//, /^\/outbox$/];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  // Sin `runtimeCaching`: nada de lo que la captura necesita se busca en la red. Una
  // entrada de runtime caching acá sería una petición que puede colgarse en una planta
  // sin señal, para servir algo que el precache ya tiene.
  runtimeCaching: [],
});

/**
 * Toda navegación dentro del alcance se responde con el `index.html` precacheado.
 *
 * El fallback importa tanto como el camino feliz: sin él, abrir
 * `/inspections/abc/capture` desde la pantalla de inicio en modo avión da el dinosaurio
 * del navegador, con el borrador intacto en IndexedDB y sin forma de llegar a él.
 */
serwist.setCatchHandler(async ({ request }) => {
  if (request.mode !== 'navigate') return Response.error();

  return (await serwist.matchPrecache('/index.html')) ?? Response.error();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.mode !== 'navigate' || url.origin !== self.location.origin) return;

  const isCaptureRoute = CAPTURE_ROUTES.some((pattern) => pattern.test(url.pathname));

  if (!isCaptureRoute) return;

  // Del precache, y punto. No hay `fetch` de red en este camino ni siquiera como
  // respaldo: si el shell no está precacheado, la instalación falló y hay que
  // enterarse, no degradar en silencio.
  event.respondWith(
    serwist.matchPrecache('/index.html').then((response) => response ?? Response.error()),
  );
});

serwist.addEventListeners();
