/**
 * ADR-010 — Almacenamiento persistente y la instalación en pantalla de inicio.
 *
 * `navigator.storage.persist()` le pide al navegador que NO desaloje la base bajo
 * presión de espacio. Sin él, un Android con poco espacio puede tirar IndexedDB y con
 * ella un recorrido de tres horas.
 *
 * **Una denegación no bloquea la captura.** ADR-010 trata la persistencia como refuerzo
 * y no como salvavidas: la mitigación real es el indicador permanente, que le dice al
 * inspector qué no salió del teléfono. Bloquear la captura por un permiso que el
 * navegador concede según su propia heurística sería cambiar un riesgo por una certeza.
 */

export type StorageMode =
  /** Concedido: el navegador no desaloja la base. */
  | 'persistent'
  /** Denegado o no soportado. Se captura igual, con el estado a la vista. */
  | 'degraded';

export interface StorageStatus {
  mode: StorageMode;
  /** Bytes usados y disponibles, cuando el navegador los informa. */
  usage: number | null;
  quota: number | null;
}

export async function requestPersistentStorage(): Promise<StorageStatus> {
  const storage = globalThis.navigator?.storage;

  if (!storage?.persist) return { mode: 'degraded', usage: null, quota: null };

  let mode: StorageMode = 'degraded';

  try {
    // `persisted()` primero: en un dispositivo donde ya se concedió, volver a pedirlo no
    // hace nada malo pero tampoco nada útil.
    mode = ((await storage.persisted?.()) || (await storage.persist()))
      ? 'persistent'
      : 'degraded';
  } catch {
    mode = 'degraded';
  }

  try {
    const estimate = await storage.estimate?.();

    return { mode, usage: estimate?.usage ?? null, quota: estimate?.quota ?? null };
  } catch {
    return { mode, usage: null, quota: null };
  }
}

/**
 * Registra el service worker. Sin él no hay shell precacheado y no hay captura sin red,
 * así que el fallo se propaga en vez de tragarse.
 */
export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;

  return navigator.serviceWorker.register('/sw.js', { scope: '/' });
}
