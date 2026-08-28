import { useSyncExternalStore } from 'react';

/**
 * Si el dispositivo cree tener red.
 *
 * QUÉ ES Y QUÉ NO ES. `navigator.onLine` dice que hay una interfaz levantada, no que el
 * servidor conteste: una red de planta sin salida a internet reporta `true`. Por eso esto
 * sirve para NOMBRAR el estado en pantalla —«You're offline», que es la explicación que el
 * inspector necesita cuando ve trabajo sin enviar— y para nada más. Ninguna decisión del
 * sistema cuelga de este valor: el trabajo se guarda igual, la cola reintenta igual, y lo
 * que dice si un envío llegó es que el servidor lo aceptó (`offline/unsynced.ts`).
 *
 * `useSyncExternalStore` y no un `useState` con efecto: el navegador ES el estado, y React
 * lo lee en cada render en vez de guardarse una copia que puede quedar vieja. En una PWA que
 * vuelve de segundo plano ese hueco —la red cambió mientras la pantalla estaba apagada— es
 * el caso normal, no el raro.
 *
 * Vive en un archivo propio y no adentro del indicador para poder probarlo sin renderizar
 * la pantalla entera.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);

  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

function getSnapshot(): boolean {
  return navigator.onLine;
}

/** Sin navegador no hay nada que reportar, y «offline» sería una afirmación que nadie hizo. */
function serverSnapshot(): boolean {
  return true;
}
