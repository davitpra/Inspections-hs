import { sessionSchema, type Session } from '@hs/contracts';

import { sessionClient } from '../api/client';
import type { SessionClient } from '../auth/session-client';
import { db, type OfflineDatabase } from './db';

/**
 * Quién está usando el dispositivo, guardado localmente.
 *
 * El `account_id` es lo que separa los borradores de una cuenta de los de otra en un
 * dispositivo compartido, y hace falta **sin red**: sin él, reabrir la aplicación en
 * modo avión no sabría de quién es el borrador que tiene delante.
 *
 * Se refresca cada vez que hay red y se lee de acá cuando no la hay. No es una caché de
 * permisos: el alcance de verdad lo resuelve el servidor en cada request contra
 * `user_site_scope` (design D4 de ADR-011). Lo de acá solo decide qué borrador se
 * muestra.
 */

const ACCOUNT_ROW_ID = 'account';

export async function readAccount(database: OfflineDatabase = db): Promise<Session | null> {
  const row = await database.tokens.get(ACCOUNT_ROW_ID);
  const parsed = sessionSchema.safeParse(row?.value);

  return parsed.success ? parsed.data : null;
}

/** Con red: pide la sesión y la guarda. Sin red: devuelve la última conocida. */
export async function refreshAccount(
  database: OfflineDatabase = db,
  client: SessionClient = sessionClient,
): Promise<Session | null> {
  // El requisito dice que abrir una pantalla de captura sin red NO produce una sola
  // petición, y arrancar preguntando por la sesión producía una — fallaba en el acto y
  // no bloqueaba nada, pero salía. Con el navegador declarando que no hay red, se lee lo
  // guardado y listo. `onLine` en `true` no garantiza conexión, y por eso el `try` de
  // abajo sigue estando: esto recorta el caso que sí se puede saber.
  if (globalThis.navigator?.onLine === false) return readAccount(database);

  try {
    const result = await client.request<unknown>('/auth/session');

    if (result.ok) {
      const session = sessionSchema.parse(result.value);
      await database.tokens.put({ id: ACCOUNT_ROW_ID, value: session });

      return session;
    }
  } catch {
    // Sin red. No es un error: es el caso normal de este sistema.
  }

  return readAccount(database);
}

/**
 * Cerrar sesión: se avisa al servidor, se borra el token y se borra la cuenta.
 *
 * **NADA MÁS SE BORRA.** Los borradores, las fotos y la cola son del inspector, no de
 * la sesión: cerrar sesión en un dispositivo compartido no puede costar un recorrido de
 * tres horas que todavía no salió. Es la misma regla que sostiene `session-client.ts`
 * del otro lado —ningún código de error significa "descartá"— y acá se ejerce.
 *
 * El `signOut` remoto puede fallar sin red y no importa: lo local se borra igual, y el
 * servidor caduca la sesión solo.
 */
export async function clearAccount(
  database: OfflineDatabase = db,
  client: SessionClient = sessionClient,
): Promise<void> {
  try {
    await client.signOut();
  } catch {
    // Sin red. El token local se borra igual: es lo que el usuario pidió.
  }

  await database.tokens.delete(ACCOUNT_ROW_ID);
}
