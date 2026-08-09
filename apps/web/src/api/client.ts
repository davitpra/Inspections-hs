import { SessionClient } from '../auth/session-client';
import { dexieTokenStore } from '../offline/token-store';

/**
 * El cliente de sesión de la aplicación, con el `TokenStore` sobre Dexie (D10).
 *
 * `SessionClient` no se toca: recibe el store por parámetro desde la etapa 1
 * precisamente para este momento.
 */

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

let onSessionEnded: (() => void) | null = null;

/**
 * Qué hacer cuando la sesión terminó de verdad. Lo único que corresponde es pedir
 * login: **nada de lo que esté en la cola se descarta**, ni acá ni en ningún lado.
 */
export function setSessionEndedHandler(handler: (() => void) | null): void {
  onSessionEnded = handler;
}

export const sessionClient = new SessionClient({
  baseUrl: API_BASE_URL,
  store: dexieTokenStore(),
  onSessionEnded: () => onSessionEnded?.(),
});
