import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { demoteToJhscMember } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';

export function DemoteDialog({
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const demotion = useMutation({
    mutationFn: () => demoteToJhscMember({ userId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.account(userId) });
      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal jhsc-seat-dialog" onClose={onClose}>
      <div className="jhsc-seat-dialog__head">
        <span className="jhsc-seat-dialog__icon" aria-hidden="true">
          <PersonIcon size={24} />
        </span>
        <div>
          <p className="jhsc-seat-dialog__eyebrow">Account role</p>
          <h2>Demote {personLabel} to inspector?</h2>
        </div>
      </div>

      <p className="jhsc-seat-dialog__text">
        They will lose administrative access from their next action.
      </p>
      <p className="jhsc-seat-dialog__note">
        <strong>They stay on the JHSC.</strong> Their sign-in, sites, and email stay the same.
      </p>

      {demotion.isError ? (
        <p className="notice" role="alert">{(demotion.error as Error).message}</p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--primary"
          onClick={() => demotion.mutate()}
          disabled={demotion.isPending}
        >
          {demotion.isPending ? 'Demoting…' : 'Demote to inspector'}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
