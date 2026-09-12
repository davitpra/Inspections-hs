import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { promoteToCoordinator } from '../../api/roster';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';

export function PromoteDialog({
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

  const promotion = useMutation({
    mutationFn: () => promoteToCoordinator({ userId }),
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
          <h2>Promote {personLabel} to H&amp;S coordinator?</h2>
        </div>
      </div>

      <p className="jhsc-seat-dialog__text">
        They will gain the same administrative access as an H&amp;S coordinator.
      </p>
      <p className="jhsc-seat-dialog__note">
        <strong>JHSC membership follows the account role.</strong>{' '}
        Their credential, sessions, email, and site access stay the same.
      </p>

      {promotion.isError ? (
        <p className="notice" role="alert">{(promotion.error as Error).message}</p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--primary"
          onClick={() => promotion.mutate()}
          disabled={promotion.isPending}
        >
          {promotion.isPending ? 'Promoting…' : 'Promote to coordinator'}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
