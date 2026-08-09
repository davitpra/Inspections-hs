import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { router } from './app/router';
import { sessionClient } from './api/client';
import { refreshOnReconnect } from './auth/session-client';
import { startOutbox } from './offline/outbox';
import { registerServiceWorker } from './offline/storage';
import './index.css';

/**
 * El arranque de la PWA.
 *
 * Tres cosas pasan acá y ninguna bloquea el render: registrar el service worker (sin él
 * no hay shell precacheado), refrescar la sesión al reconectar, y arrancar el outbox.
 *
 * El outbox arranca ACÁ y no en el service worker (D2): garantizar "un solo envío en
 * vuelo" es más fácil en un contexto que en dos. Corre al montar y en el evento
 * `online`; el tercer disparador —terminar una inspección— lo dispara la pantalla de
 * revisión.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Sin red, un reintento automático es una espera que no lleva a nada. Lo que se
      // puede leer del dispositivo ya está en Dexie, y lo que no, no está.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

void registerServiceWorker();
refreshOnReconnect(sessionClient);
startOutbox();

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root en index.html');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
