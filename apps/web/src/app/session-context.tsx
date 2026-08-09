import type { Session } from '@hs/contracts';
import { createContext, use, useCallback, useEffect, useMemo, useState } from 'react';

import { setSessionEndedHandler } from '../api/client';
import { clearAccount, refreshAccount } from '../offline/account';
import { requestPersistentStorage, type StorageStatus } from '../offline/storage';

/**
 * Lo que toda pantalla necesita saber antes de dibujar nada: quién está usando el
 * dispositivo y si el almacenamiento es persistente.
 *
 * Las dos se resuelven una vez, al arrancar, y las dos tienen respuesta sin red: la
 * cuenta sale de lo último guardado y la persistencia es una pregunta al navegador.
 *
 * `reload()` existe porque iniciar sesión tiene que poder decirle a la aplicación que
 * ahora hay alguien. Sin él, el formulario escribiría el token en Dexie y la pantalla
 * seguiría creyendo que no hay cuenta hasta la próxima carga completa.
 */

export interface AppSession {
  account: Session | null;
  storage: StorageStatus;
  ready: boolean;
  /** Vuelve a resolver la cuenta. Lo llama el formulario de login al terminar. */
  reload: () => Promise<void>;
  /** Cierra sesión: borra el token y la cuenta, y NADA más (ver `signOut`). */
  signOut: () => Promise<void>;
}

/** Lo que se sabe antes de preguntar nada. Sin cuenta y sin persistencia confirmada. */
type ResolvedState = Pick<AppSession, 'account' | 'storage' | 'ready'>;

const INITIAL: ResolvedState = {
  account: null,
  storage: { mode: 'degraded', usage: null, quota: null },
  ready: false,
};

const SessionContext = createContext<AppSession>({
  ...INITIAL,
  reload: async () => {},
  signOut: async () => {},
});

export function SessionProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [state, setState] = useState<ResolvedState>(INITIAL);

  const reload = useCallback(async (): Promise<void> => {
    const account = await refreshAccount();
    setState((current) => ({ ...current, account, ready: true }));
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    await clearAccount();
    setState((current) => ({ ...current, account: null, ready: true }));
  }, []);

  /**
   * Cuando el servidor dice que la sesión terminó, la aplicación pide login de nuevo —
   * y **nada más**. No se toca el borrador, ni las fotos, ni la cola: `session_ended`
   * significa "volvé a identificarte", no "perdiste el trabajo". Sin este gancho, un
   * `session_ended` no producía ninguna reacción en la interfaz y el inspector veía
   * pantallas vacías sin saber por qué.
   */
  useEffect(() => {
    setSessionEndedHandler(() => {
      setState((current) => ({ ...current, account: null, ready: true }));
    });

    return () => setSessionEndedHandler(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      // ADR-010 — se pide al arrancar. Una denegación NO bloquea nada: se guarda como
      // estado y se muestra como almacenamiento degradado.
      const storage = await requestPersistentStorage();
      const account = await refreshAccount();

      if (!cancelled) setState({ account, storage, ready: true });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AppSession>(
    () => ({ ...state, reload, signOut }),
    [state, reload, signOut],
  );

  return <SessionContext value={value}>{children}</SessionContext>;
}

export function useAppSession(): AppSession {
  return use(SessionContext);
}
