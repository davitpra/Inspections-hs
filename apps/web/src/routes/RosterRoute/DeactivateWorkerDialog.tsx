import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { queryKeys } from '../../api/query-keys';
import { deactivatePerson } from '../../api/roster';
import { CrossCircleIcon } from '../../components/icons';

/** Confirma una baja del roster; no elimina la persona ni administra una cuenta. */
export function DeactivateWorkerDialog({
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
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const deactivate = useMutation({
    mutationFn: () => deactivatePerson({ personId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.roster(siteId) });
      dialogRef.current?.close();
    },
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal remove-access-dialog"
      onCancel={(event) => {
        if (deactivate.isPending) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="remove-access-dialog__head">
        <span className="remove-access-dialog__icon" aria-hidden="true">
          <CrossCircleIcon size={24} />
        </span>
        <div>
          <p className="remove-access-dialog__eyebrow">Roster</p>
          <h2>Remove {personLabel} from the roster?</h2>
        </div>
      </div>

      <p className="remove-access-dialog__intro">
        They will no longer appear in active rosters or new record selectors.
      </p>

      <div className="remove-access-dialog__note">
        <p className="remove-access-dialog__note-title">Historical records stay intact</p>
        <p className="remove-access-dialog__note-text">
          A later roster import can restore this worker if the file marks them active.
        </p>
      </div>

      {deactivate.isError ? (
        <p className="notice notice--warn" role="alert">
          {deactivate.error.message}
        </p>
      ) : null}

      <div className="remove-access-dialog__actions">
        <button
          type="button"
          className="button--danger"
          disabled={deactivate.isPending}
          onClick={() => deactivate.mutate()}
        >
          {deactivate.isPending ? 'Removing…' : 'Remove worker'}
        </button>
        <button
          type="button"
          disabled={deactivate.isPending}
          onClick={() => dialogRef.current?.close()}
        >
          Keep worker
        </button>
      </div>
    </dialog>
  );
}
