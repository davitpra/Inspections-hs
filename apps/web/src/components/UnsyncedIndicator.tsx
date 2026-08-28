import { useEffect, useState } from 'react';

import { useOnline } from '../offline/online';
import { emptyStatus, unsyncedLabel, unsyncedStatus, type UnsyncedStatus } from '../offline/unsynced';
import { WifiOffIcon } from './icons';

/**
 * El indicador permanente de ADR-010.
 *
 * **No es descartable mientras haya trabajo sin enviar**, y eso no es una decisión de
 * diseño visual: es la mitigación que convierte el supuesto de los 7 días en algo que
 * el inspector puede verificar por sí mismo. Un indicador que se puede cerrar es un
 * indicador que estará cerrado el día que importe.
 *
 * Está presente en TODA pantalla de captura, con o sin red. Que no haya conexión es
 * exactamente cuando el número importa más.
 *
 * «You're offline» va DELANTE del número y no en lugar de él. El número es el hecho —tanto
 * trabajo no salió de este teléfono— y la falta de red es la explicación de por qué. Sin la
 * explicación, un inspector con señal y un inspector sin señal leen el mismo aviso y solo
 * uno de los dos puede hacer algo al respecto. El ícono no lleva texto propio: lo nombra la
 * línea que tiene al lado.
 */
export function UnsyncedIndicator({ accountId }: { accountId: string | null }): React.JSX.Element | null {
  const status = useUnsyncedStatus(accountId);
  const online = useOnline();
  const label = unsyncedLabel(status);

  if (!label) return null;

  return (
    <aside
      className={status.warn ? 'unsynced unsynced--warn' : 'unsynced'}
      role={status.warn ? 'alert' : 'status'}
      aria-live="polite"
    >
      {online ? null : <WifiOffIcon />}

      <div className="unsynced__text">
        <p className="unsynced__count">
          {online ? null : <strong className="unsynced__lead">You&rsquo;re offline</strong>}
          {label}
        </p>

        {status.warn ? (
          <p className="unsynced__warning">
            Connect to the network to submit your work. Nothing has left this device yet.
          </p>
        ) : null}
      </div>
    </aside>
  );
}

/**
 * Se recalcula cada pocos segundos y no con un evento: el borrador cambia desde varios
 * lugares —captura, subida de fotos, outbox— y suscribirse a todos sería un mecanismo
 * más para mantener sincronizado. El costo es un par de consultas a IndexedDB.
 */
export function useUnsyncedStatus(accountId: string | null, intervalMs = 5_000): UnsyncedStatus {
  const [status, setStatus] = useState<UnsyncedStatus>(emptyStatus);

  useEffect(() => {
    if (!accountId) return;

    let cancelled = false;

    const refresh = async (): Promise<void> => {
      const next = await unsyncedStatus(accountId);
      if (!cancelled) setStatus(next);
    };

    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [accountId, intervalMs]);

  // Sin cuenta no hay trabajo que contar, y se deriva en vez de guardarse: un `setState`
  // en el efecto para representar "nada" es un render de más y un estado que puede
  // quedar viejo respecto de su propia entrada.
  return accountId ? status : emptyStatus();
}
