import { useState } from 'react';

/**
 * El link de un solo uso, recién emitido.
 *
 * **VIVE ADENTRO DEL MODAL, Y ESE MODAL LO MONTA LA CONSOLA, NO LA FILA.** Invitar
 * invalida el roster, el refetch devuelve a la persona ya CON cuenta, y la celda de rol
 * deja de renderizar el botón para renderizar la etiqueta: la fila que originó la
 * invitación se desmonta en el mismo momento en que la invitación existe. Un token
 * guardado adentro de esa fila se iría con ella —se crearía y se perdería en el mismo
 * instante—, y como el servidor no lo vuelve a dar, la única salida sería revocar y
 * reemitir algo que nunca se pudo copiar. `InviteDialog.tsx` es quien lo guarda, y
 * `index.tsx` lo monta fuera de la tabla por esa misma razón.
 *
 * Sigue sin persistirse en ningún lado: no está en Dexie, no está en la caché de TanStack
 * Query y no hay ruta que lo vuelva a pedir. Vive en el estado del modal mientras el modal
 * está en pantalla, que es exactamente lo que "se muestra una vez" quiere decir.
 */
export function InvitationLink({
  personLabel,
  token,
  onDismiss,
}: {
  personLabel: string;
  token: string;
  onDismiss: () => void;
}): React.JSX.Element {
  const [copied, setCopied] = useState(false);

  const link = `${window.location.origin}/accept-invitation?token=${token}`;

  return (
    <div className="notice">
      <p>
        Invited {personLabel}. Copy this one-time link and send it to them — it is shown
        once and cannot be shown again.
      </p>

      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(link);
          setCopied(true);
        }}
      >
        {copied ? 'Copied' : 'Copy invitation link'}
      </button>

      {/* Descartar es explícito: nadie pierde el link por navegar dentro de la consola. */}
      <button type="button" onClick={onDismiss}>
        Done
      </button>
    </div>
  );
}
