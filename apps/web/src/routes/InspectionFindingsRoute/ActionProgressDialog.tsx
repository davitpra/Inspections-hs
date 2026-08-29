import { useQuery } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import { getAction } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { ActionProgressPanel } from '../../components/ActionProgressPanel';
import { ActionTimeline } from '../../components/ActionTimeline';

export function ActionProgressDialog({
  actionId,
  onClose,
  returnFocusTo,
}: {
  actionId: string;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}): React.JSX.Element {
  const { account } = useAppSession();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [transitionPending, setTransitionPending] = useState(false);
  const action = useQuery({
    queryKey: queryKeys.action(actionId),
    queryFn: () => getAction(actionId),
    retry: false,
  });

  useEffect(() => {
    const returnTarget = returnFocusTo.current;
    dialogRef.current?.showModal();

    return () => returnTarget?.focus();
  }, [returnFocusTo]);

  const close = (): void => {
    if (!transitionPending) dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      className="modal action-progress-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        if (transitionPending) event.preventDefault();
      }}
      onClose={onClose}
    >
      <div className="action-progress-dialog__head">
        <div>
          <p className="action-detail__eyebrow">Corrective action</p>
          <h2 id={titleId}>Update corrective action</h2>
        </div>
        <button
          type="button"
          className="button--outline"
          disabled={transitionPending}
          onClick={close}
        >
          Close
        </button>
      </div>

      {action.isError ? (
        <p role="alert" className="notice notice--warn">
          This action needs a connection. Its history could not be loaded.
        </p>
      ) : !action.data ? (
        <p>Loading the action…</p>
      ) : (
        <>
          <p className="action-progress-dialog__description">{action.data.description}</p>
          <div className="action-progress-dialog__layout">
            <ActionTimeline events={action.data.events} />
            <ActionProgressPanel
              action={action.data}
              session={account}
              onPendingChange={setTransitionPending}
            />
          </div>
        </>
      )}
    </dialog>
  );
}
