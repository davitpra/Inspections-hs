import {
  transitionsFrom,
  type Action,
  type ActionTransition,
  type EvidenceInput,
  type Session,
} from '@hs/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { transitionAction, uploadEvidence } from '../api/actions';
import { queryKeys } from '../api/query-keys';
import { canAttempt } from '../permissions/actions';
import { transitionLabel } from '../presentation/actions';
import { CheckCircleIcon } from './icons';
import { EvidencePicker } from './EvidencePicker';

export function ActionProgressPanel({
  action,
  session,
  onPendingChange,
}: {
  action: Action;
  session: Session | null;
  onPendingChange?: (pending: boolean) => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<{ kind: EvidenceInput['kind']; file: File }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const available = transitionsFrom(action.state).filter((transition) =>
    canAttempt(transition, action, session),
  );

  const move = useMutation({
    mutationFn: async (transition: ActionTransition) => {
      const evidence: EvidenceInput[] = [];

      for (const item of files) {
        evidence.push({
          kind: item.kind,
          object_key: await uploadEvidence(action.id, item.file),
        });
      }

      return transitionAction(action.id, {
        to: transition.to,
        note: note.trim() === '' ? undefined : note.trim(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
        evidence,
      });
    },
    onSuccess: async () => {
      setReason('');
      setNote('');
      setFiles([]);
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.action(action.id) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.actions() }),
      ]);
    },
    onError: (caught: Error) => setError(caught.message),
  });

  useEffect(() => {
    onPendingChange?.(move.isPending);
  }, [move.isPending, onPendingChange]);

  if (action.state === 'closed') {
    return (
      <section className="card action-detail__closed">
        <span className="action-detail__closed-icon">
          <CheckCircleIcon size={24} />
        </span>
        <div>
          <h2>Action closed</h2>
          <p>Work that comes undone is reported as a new finding.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card action-detail__work" aria-labelledby="action-next-heading">
      <div className="action-detail__section-head">
        <div>
          <p className="action-detail__eyebrow">Next step</p>
          <h2 id="action-next-heading">What now</h2>
        </div>
      </div>

      {available.some((transition) => transition.requires.includes('after_evidence')) ? (
        <EvidencePicker files={files} onChange={setFiles} />
      ) : null}

      {available.some((transition) => transition.requires.includes('reason')) ? (
        <label className="action-detail__field">
          <span>Reason</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}

      <label className="action-detail__field">
        <span>
          Note <span className="action-detail__optional">Optional</span>
        </span>
        <textarea value={note} onChange={(event) => setNote(event.target.value)} />
      </label>

      {available.length > 0 ? (
        <div className="action-detail__actions">
          {available.map((transition, index) => (
            <button
              key={transition.to}
              type="button"
              className={index === 0 ? 'button--primary' : 'button--outline'}
              disabled={move.isPending}
              onClick={() => move.mutate(transition)}
            >
              {transitionLabel(action.state, transition.to)}
            </button>
          ))}
        </div>
      ) : (
        <p className="notice action-detail__waiting">
          Nothing for you to do here: someone else has to move this one along.
        </p>
      )}

      {error ? <p role="alert" className="notice notice--warn action-detail__error">{error}</p> : null}
    </section>
  );
}
