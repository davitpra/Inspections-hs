import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { makeScheduledInspectionVisible } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';

/** Confirma la transición irreversible que adelanta una asignación futura. */
export function MakeVisibleDialog({
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const makeVisible = useMutation({
    mutationFn: () => makeScheduledInspectionVisible(inspection.id),
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
      aria-label="Make inspection visible"
      onClose={() => { onClose(); returnFocusRef.current?.focus(); }}
    >
      <div className="modal__head"><h2>Make {label} visible?</h2></div>
      <p className="modal__text">
        This inspection will appear in the assigned inspector&apos;s pending list immediately. This cannot be undone.
      </p>

      {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--primary"
          disabled={makeVisible.isPending}
          onClick={() => makeVisible.mutate()}
        >
          {makeVisible.isPending ? 'Making visible…' : 'Make visible'}
        </button>
        <button type="button" disabled={makeVisible.isPending} onClick={() => dialogRef.current?.close()}>Cancel</button>
      </div>
    </dialog>
  );
}
