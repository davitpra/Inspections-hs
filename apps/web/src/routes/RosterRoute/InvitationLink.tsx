import { useState } from 'react';

import { CheckCircleIcon, CheckIcon, LockIcon } from '../../components/icons';

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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  const link = `${window.location.origin}/accept-invitation?token=${token}`;

  return (
    <div className="invitation-link">
      <div className="invitation-link__head">
        <span className="invitation-link__success" aria-hidden="true">
          <CheckCircleIcon size={28} />
        </span>
        <div>
          <p className="invitation-link__eyebrow">Invitation created</p>
          <h2>Ready to send</h2>
        </div>
      </div>

      <p className="invitation-link__intro">
        <strong>{personLabel}</strong> can join the JHSC using the invitation link below.
      </p>

      <div className="invitation-link__warning">
        <span className="invitation-link__lock" aria-hidden="true">
          <LockIcon size={20} />
        </span>
        <div>
          <p className="invitation-link__warning-title">Copy this link now</p>
          <p className="invitation-link__warning-text">
            For security, it is shown only once and cannot be recovered after you close this window.
          </p>
        </div>
      </div>

      <button
        type="button"
        className="button--primary invitation-link__copy"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(link);
            setCopyStatus('copied');
          } catch {
            setCopyStatus('error');
          }
        }}
      >
        {copyStatus === 'copied' ? <CheckIcon size={18} /> : null}
        {copyStatus === 'copied' ? 'Link copied' : 'Copy invitation link'}
      </button>

      <p
        className={copyStatus === 'error' ? 'invitation-link__status invitation-link__status--error' : 'invitation-link__status'}
        aria-live="polite"
      >
        {copyStatus === 'copied'
          ? 'Paste it into a secure message to the invitee.'
          : copyStatus === 'error'
            ? 'Could not copy the link. Check your browser permissions and try again.'
            : 'The link stays hidden to protect the invitation.'}
      </p>

      {/* Descartar es explícito: nadie pierde el link por navegar dentro de la consola. */}
      <button type="button" className="invitation-link__done" onClick={onDismiss}>
        Done
      </button>
    </div>
  );
}
