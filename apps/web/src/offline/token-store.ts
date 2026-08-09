import type { TokenPair } from '@hs/contracts';

import type { TokenStore } from '../auth/session-client';
import { db, type OfflineDatabase } from './db';

/**
 * Design D10 — El `TokenStore` sobre Dexie.
 *
 * `SessionClient` no cambia ni una línea: recibe un `TokenStore` y esto es uno. Si
 * hubiera hecho falta tocarlo, el diseño se habría desviado — la inyección del store
 * existe desde la etapa 1 exactamente para este momento.
 *
 * `localStorage` queda para los tests y para las pantallas que no son de captura. El
 * outbox necesita el token donde `localStorage` no llega: hoy corre en la ventana
 * (D2), pero mudarlo al service worker no debe requerir tocar la sesión.
 */

const TOKEN_ROW_ID = 'session';

export function dexieTokenStore(database: OfflineDatabase = db): TokenStore {
  return {
    async read(): Promise<TokenPair | null> {
      const row = await database.tokens.get(TOKEN_ROW_ID);
      return (row?.value as TokenPair | undefined) ?? null;
    },

    async write(tokens: TokenPair | null): Promise<void> {
      // `null` borra el token y NADA MÁS. Lo que haya en `drafts`, `photos` u `outbox`
      // es del inspector y no de la sesión: cerrar sesión no descarta trabajo sin
      // enviar, y esa es la misma regla que `session-client.ts` sostiene del otro lado.
      if (!tokens) {
        await database.tokens.delete(TOKEN_ROW_ID);
        return;
      }

      await database.tokens.put({ id: TOKEN_ROW_ID, value: tokens });
    },
  };
}
