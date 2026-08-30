import {
  transitionsFrom,
  type Action,
  type ActionTransition,
  type EvidenceInput,
  type Session,
} from '@hs/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { transitionAction, uploadEvidence } from '../api/actions';
import { queryKeys } from '../api/query-keys';
import { canAttempt } from '../permissions/actions';
import { transitionLabel, transitionTakesNote } from '../presentation/actions';
import { EvidencePicker } from './EvidencePicker';

/**
 * Los campos y los botones de una transición, sin el marco que la envuelve.
 *
 * `FindingNextStep` lo dibuja, a la vista, dentro de la ficha del hallazgo: la mutación, los
 * campos que cada transición exige y el rechazo del servidor quedan juntos para que el paso no
 * tenga dos implementaciones.
 *
 * `action` pide solo lo que `canAttempt` y `transitionsFrom` necesitan —el mismo recorte que
 * ya usa `canAttempt`—, así que entra tanto un `Action` completo como el `ActionSummary` sin
 * eventos que trae el listado de la ruta de hallazgos.
 */
export function ActionTransitionForm({
  action,
  session,
  onDone,
}: {
  action: Pick<Action, 'id' | 'state' | 'assignee_person_id'>;
  session: Session | null;
  onDone?: () => void;
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
         queryClient.invalidateQueries({ queryKey: queryKeys.findings() }),
         queryClient.invalidateQueries({ queryKey: queryKeys.submittedInspection() }),
       ]);
      onDone?.();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (available.length === 0) {
    return (
      <p className="notice action-detail__waiting">
        Nothing for you to do here: someone else has to move this one along.
      </p>
    );
  }

  return (
    <div className="action-detail__transition-form">
      {available.some((transition) => transition.to === 'awaiting_verification') ? (
        <EvidencePicker files={files} onChange={setFiles} />
      ) : null}

      {available.some((transition) => transition.requires.includes('reason')) ? (
        <label className="action-detail__field">
          <span>Reason</span>
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}

      {available.some((transition) => transitionTakesNote(action.state, transition.to)) ? (
        <label className="action-detail__field">
          <span>
            Note <span className="action-detail__optional">Optional</span>
          </span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      ) : null}

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

      {error ? <p role="alert" className="notice notice--warn action-detail__error">{error}</p> : null}
    </div>
  );
}
