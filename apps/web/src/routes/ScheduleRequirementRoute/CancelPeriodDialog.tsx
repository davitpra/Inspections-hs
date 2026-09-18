import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { cancelScheduledInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';

/** Confirma la cancelación irreversible de un período abierto y pide su motivo. */
export function CancelPeriodDialog({
  inspection,
  label,
  onClose,
}: {
  inspection: ScheduledInspection;
  label: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const reasonId = useId();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const cancel = useMutation({
    mutationFn: () => cancelScheduledInspection(inspection.id, reason),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });
      dialogRef.current?.close();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label={`Cancel ${label}`}
      onClose={() => { onClose(); returnFocusRef.current?.focus(); }}
    >
      <div className="modal__head"><h2>Cancel {label}?</h2></div>
      <p className="modal__text">Cancelling cannot be undone. The period is scheduled again instead.</p>

      <div className="modal__form modal__form--spaced">
        <label htmlFor={`${reasonId}-reason`}>Cancel with a reason</label>
        <textarea
          id={`${reasonId}-reason`}
          value={reason}
          maxLength={500}
          disabled={cancel.isPending}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Why this period will not be inspected"
        />
      </div>

      {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--danger"
          disabled={reason.trim() === '' || cancel.isPending}
          onClick={() => cancel.mutate()}
        >
          {cancel.isPending ? 'Cancelling…' : 'Confirm cancellation'}
        </button>
        <button type="button" disabled={cancel.isPending} onClick={() => dialogRef.current?.close()}>Keep this period</button>
      </div>
    </dialog>
  );
}
