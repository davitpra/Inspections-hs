import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { getAccount, reissueInvitation } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import { InvitationLink } from './InvitationLink';

/**
 * design D1/D3/D5/D6 (`reissue-invitation-link-from-roster`) — Reemite el link de una
 * cuenta que ya existe y no puede entrar todavía: el remedio del token que se perdió, se
 * copió mal, o venció. El servidor revoca la pendiente en el mismo acto de emitir la
 * nueva (design D1), así que esta pantalla no necesita saber si había una: solo
 * confirmar, porque el efecto es dejar sin uso un link que puede estar en el correo de
 * alguien.
 *
 * **Precarga el correo actual y lo deja editable** (design D6): el motivo más común de
 * reemitir es que ese correo estaba mal escrito y el primer link nunca llegó. El roster
 * no lo trae —lo omite a propósito—, así que acá se pide con `getAccount`. El botón de
 * emitir queda deshabilitado mientras esa consulta no resolvió: emitir con el campo
 * todavía vacío mandaría el link a una dirección que el coordinador no llegó a ver.
 *
 * **No crea cuenta** — es lo que lo distingue de `InviteDialog.tsx`, y por eso es un
 * componente propio y no ese mismo con un flag (design D3): atarlos con un booleano deja
 * un formulario donde la mitad de los campos no aplica según el caso.
 *
 * El token sigue viviendo fuera de la fila por la misma razón que en `InviteDialog`
 * (D8/D4): reemitir invalida el roster, la fila no cambia de forma pero el modal tiene
 * que sobrevivir de todos modos a cualquier refetch. `InvitationLink.tsx` se reusa sin
 * tocar — es la pieza que muestra-y-copia una sola vez, y es la misma para los dos flujos.
 */
export function ReissueDialog({
  userId,
  personLabel,
  siteId,
  onClose,
}: {
  userId: string;
  personLabel: string;
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const emailId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [invitation, setInvitation] = useState<{ token: string } | null>(null);

  /**
   * `null` mientras el coordinador no tocó el campo: se muestra `account.data.email` sin
   * guardar una copia propia, así que un refetch de fondo no le pisa nada porque no hay
   * nada que pisar. En cuanto escribe, el valor pasa a vivir acá y deja de seguir a la
   * consulta — sin `useEffect`, que es lo que produciría el efecto contrario (pisarlo).
   */
  const [edited, setEdited] = useState<string | null>(null);

  const account = useQuery({
    queryKey: queryKeys.account(userId),
    queryFn: () => getAccount(userId),
  });

  const email = edited ?? account.data?.email ?? '';

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const reissue = useMutation({
    mutationFn: () =>
      reissueInvitation({
        userId,
        email: account.data && email !== account.data.email ? email : undefined,
      }),
    onSuccess: (result) => {
      if (result.invitation) {
        setInvitation({ token: result.invitation.token });
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(userId) });
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      {invitation ? (
        <InvitationLink
          personLabel={personLabel}
          token={invitation.token}
          onDismiss={() => dialogRef.current?.close()}
        />
      ) : (
        <>
          <h2>New invitation link for {personLabel}?</h2>
          <p>The previous link stops working as soon as the new one is issued.</p>

          <div className="filters">
            <label htmlFor={emailId}>Email</label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(event) => setEdited(event.target.value)}
              disabled={account.isLoading}
            />
            <p className="note">Currently registered. Edit to correct it.</p>
          </div>

          {account.isError ? (
            <p className="notice">Could not load the current email.</p>
          ) : null}

          <button
            type="button"
            onClick={() => reissue.mutate()}
            disabled={account.isLoading || email.trim() === '' || reissue.isPending}
          >
            {reissue.isPending ? 'Generating…' : 'Generate new link'}
          </button>

          {reissue.isError ? <p className="notice">{(reissue.error as Error).message}</p> : null}

          <button type="button" onClick={() => dialogRef.current?.close()}>
            Cancel
          </button>
        </>
      )}
    </dialog>
  );
}
