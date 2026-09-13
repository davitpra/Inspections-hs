import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { inviteAsJhscMember } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';
import { InvitationLink } from './InvitationLink';

/**
 * design D4/D7 — El modal de invitación: crea la cuenta como `inspector` y emite la
 * invitación en el mismo acto. El sitio es el que la consola ya está mirando (D7, no una
 * elección aparte); el email SÍ se pide — no está en `person` y no se puede derivar del
 * número de empleado.
 *
 * Tiene estado y `useMutation`, así que va en su propio archivo (`CLAUDE.md`, rutas
 * grandes) y no inline en `index.tsx`. El botón corto de la fila, en cambio, ya no tiene
 * ni lo uno ni lo otro y por eso vive inline en `index.tsx`.
 *
 * **EL TOKEN VIVE ACÁ ADENTRO, Y ESA ES TODA LA RAZÓN DE QUE ESTE ARCHIVO EXISTA
 * SEPARADO DE LA FILA.** Invitar invalida el roster, y el refetch devuelve a esta persona
 * ya con cuenta: la celda pasa a mostrar el rol. Si el formulario viviera adentro de la
 * fila, se desmontaría con ella y el token —que el servidor no vuelve a dar— se perdería
 * en el mismo instante en que se creó. `index.tsx` monta este modal fuera de la tabla,
 * así que sobrevive al desmontaje de la fila que lo abrió. Ver `InvitationLink.tsx`.
 */
export function InviteDialog({
  personId,
  personLabel,
  siteId,
  onClose,
}: {
  personId: string;
  personLabel: string;
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const emailId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);

  const [email, setEmail] = useState('');
  const [invitation, setInvitation] = useState<{ token: string } | null>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const invite = useMutation({
    mutationFn: () => inviteAsJhscMember({ personId, email, siteId }),
    onSuccess: (result) => {
      if (result.invitation) {
        setInvitation({ token: result.invitation.token });
      }

      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
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
        <form
          className="invite-dialog"
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate();
          }}
        >
          <div className="invite-dialog__head">
            <span className="invite-dialog__icon" aria-hidden="true">
              <PersonIcon size={24} />
            </span>
            <div>
              <p className="invite-dialog__eyebrow">JHSC access</p>
              <h2>Invite {personLabel}</h2>
            </div>
          </div>

          <p className="invite-dialog__intro">
            Create a secure, one-time invitation link for this member.
          </p>

          <div className="invite-dialog__field">
            <label htmlFor={emailId}>Email for {personLabel}</label>
            <input
              id={emailId}
              type="email"
              placeholder="name@company.com"
              autoComplete="email"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          {invite.isError ? (
            <p className="notice" role="alert">{(invite.error as Error).message}</p>
          ) : null}

          <div className="invite-dialog__actions">
            <button type="button" onClick={() => dialogRef.current?.close()}>
              Cancel
            </button>
            <button
              type="submit"
              className="button--primary"
              disabled={email.trim() === '' || invite.isPending}
            >
              {invite.isPending ? 'Generating…' : 'Generate link'}
            </button>
          </div>
        </form>
      )}
    </dialog>
  );
}
