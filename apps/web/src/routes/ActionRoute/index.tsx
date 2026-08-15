import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from '@tanstack/react-router';
import { transitionsFrom, type ActionTransition, type EvidenceInput } from '@hs/contracts';

import { getAction, transitionAction, uploadEvidence } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { StateBadge } from '../../components/StateBadge';
import { canAttempt, STATE_LABELS, formatDate, transitionLabel } from '../action-permissions';
import { EvidencePicker } from './EvidencePicker';

/**
 * El detalle de una acción correctiva: su historia y lo que se puede hacer con ella.
 *
 * **Los botones salen de `TRANSITIONS`, no de un `if` escrito acá.** Es la misma tabla
 * que el servicio consulta y que la guarda de 0011 reproduce en SQL: si la UI la
 * reimplementara, el día que la máquina cambie habría dos verdades y una pantalla que
 * ofrece lo que el servidor rechaza.
 *
 * Lo que la UI **no** decide y por eso no comprueba: que quien verifica no sea quien
 * ejecutó. Esa regla necesita saber quién declaró el trabajo hecho, y el servidor ya lo
 * sabe; adelantarla acá sería copiar media regla y confiar en que las dos mitades no se
 * separen. El botón se ofrece y el error del servidor se muestra.
 */
export function ActionRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/actions/$id' });
  const { account } = useAppSession();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [files, setFiles] = useState<{ kind: EvidenceInput['kind']; file: File }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const action = useQuery({
    queryKey: queryKeys.action(id),
    queryFn: () => getAction(id),
    retry: false,
  });

  const move = useMutation({
    mutationFn: async (transition: ActionTransition) => {
      // Las fotos suben primero y por su propio camino (ADR-006): la transición viaja
      // con object keys, nunca con bytes.
      const evidence: EvidenceInput[] = [];

      for (const item of files) {
        evidence.push({ kind: item.kind, object_key: await uploadEvidence(id, item.file) });
      }

      return transitionAction(id, {
        to: transition.to,
        note: note.trim() === '' ? undefined : note.trim(),
        reason: reason.trim() === '' ? undefined : reason.trim(),
        evidence,
      });
    },
    onSuccess: () => {
      setReason('');
      setNote('');
      setFiles([]);
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.action(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.actions() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (action.isError) return <p className="notice">This action needs a connection.</p>;
  if (!action.data) return <p>Loading…</p>;

  const current = action.data;
  const available = transitionsFrom(current.state).filter((transition) =>
    canAttempt(transition, current, account),
  );

  return (
    <>
      <h1>{current.description}</h1>

      <p>
        <StateBadge state={current.state} /> Due {formatDate(current.due_at)} — severity{' '}
        {current.severity}
        {current.overdue && current.state !== 'closed' ? (
          <span className="badge badge--overdue">Overdue</span>
        ) : null}
      </p>

      {current.escalations.length > 0 ? (
        <p className="notice">
          Escalated to{' '}
          {current.escalations
            .map((escalation) => `${escalation.level} (${escalation.days_overdue} days late)`)
            .join(', ')}
        </p>
      ) : null}

      <h2>History</h2>

      {/* El stream, en orden. Es el registro: no hay estado que mostrar aparte de esto. */}
      <ol className="list">
        {current.events.map((event) => (
          <li key={event.id} className="list__row">
            <span>
              {STATE_LABELS[event.to_state]} — {formatDate(event.occurred_at)}
            </span>
            {event.reason ? <p>Reason: {event.reason}</p> : null}
            {event.note ? <p>{event.note}</p> : null}
            {event.evidence.length > 0 ? (
              <p>
                {event.evidence.filter((item) => item.kind === 'before').length} before,{' '}
                {event.evidence.filter((item) => item.kind === 'after').length} after
              </p>
            ) : null}
          </li>
        ))}
      </ol>

      {current.state === 'closed' ? (
        // `closed` es terminal: no hay botón de reabrir, y su ausencia es la decisión
        // (design D14). Si el trabajo se deshizo, lo que hay es un hallazgo nuevo.
        <p>This action is closed. Work that comes undone is reported as a new finding.</p>
      ) : (
        <>
          <h2>What now</h2>

          {available.some((transition) => transition.requires.includes('after_evidence')) ? (
            <EvidencePicker files={files} onChange={setFiles} />
          ) : null}

          {available.some((transition) => transition.requires.includes('reason')) ? (
            <label>
              Reason
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
            </label>
          ) : null}

          <label>
            Note (optional)
            <textarea value={note} onChange={(event) => setNote(event.target.value)} />
          </label>

          {available.map((transition) => (
            <button
              key={transition.to}
              type="button"
              disabled={move.isPending}
              onClick={() => move.mutate(transition)}
            >
              {transitionLabel(current.state, transition.to)}
            </button>
          ))}

          {available.length === 0 ? (
            <p>Nothing for you to do here: someone else has to move this one along.</p>
          ) : null}
        </>
      )}

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
