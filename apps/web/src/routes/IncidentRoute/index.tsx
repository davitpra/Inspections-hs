import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { IncidentTransition } from '@hs/contracts';

import { getIncident, transitionIncident } from '../../api/incidents';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { availableTransitions } from '../../permissions/incidents';
import { formatInstant } from '../../presentation/dates';
import { BODY_PART_LABELS, CLASSIFICATION_LABELS, INCIDENT_STATE_LABELS, TREATMENT_LABELS, incidentTransitionLabel } from '../../presentation/incidents';
import { Clocks } from './Clocks';
import { Field } from './Field';
import { Investigation } from './Investigation';

/**
 * El detalle de un incidente: qué pasó, qué relojes corren, y qué se puede hacer.
 *
 * El vocabulario de incidentes vive en `src/presentation/incidents.ts` y no en esta
 * carpeta: lo importan cuatro rutas —la lista, el Form 7, el reporte y ésta—, así que es
 * compartido y no la lógica de esta pantalla.
 *
 * **Los botones salen de `INCIDENT_TRANSITIONS`, no de un `if` escrito acá.** Es la
 * misma tabla que el servicio consulta y que la guarda de 0012 reproduce en SQL.
 *
 * Lo que la UI **no** decide y por eso no comprueba: que no queden acciones abiertas y
 * que haya causa raíz. Las dos dependen del estado de otras filas; el botón se ofrece y
 * el error del servidor se muestra, porque media regla copiada acá es una que puede
 * separarse de su otra mitad.
 */
export function IncidentRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/incidents/$id' });
  const { account } = useAppSession();
  const queryClient = useQueryClient();

  const [reason, setReason] = useState('');
  const [method, setMethod] = useState<'five_whys' | 'cause_tree'>('five_whys');
  const [sequence, setSequence] = useState('');
  const [error, setError] = useState<string | null>(null);

  const incident = useQuery({
    queryKey: queryKeys.incident(id),
    queryFn: () => getIncident(id),
    retry: false,
  });

  const move = useMutation({
    mutationFn: (transition: IncidentTransition) =>
      transitionIncident(id, {
        to: transition.to,
        reason: reason.trim() === '' ? undefined : reason.trim(),
        method: transition.to === 'under_investigation' ? method : undefined,
        sequence_of_events:
          transition.to === 'under_investigation' && sequence.trim() !== ''
            ? sequence.trim()
            : undefined,
      }),
    onSuccess: () => {
      setReason('');
      setSequence('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.incident(id) });
      void queryClient.invalidateQueries({ queryKey: queryKeys.incidents() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  if (incident.isError) return <p className="notice">This incident needs a connection.</p>;
  if (!incident.data) return <p>Loading…</p>;

  const current = incident.data;
  const available = availableTransitions(current, account);

  return (
    <>
      <h1>{CLASSIFICATION_LABELS[current.classification]}</h1>

      <p>
        {INCIDENT_STATE_LABELS[current.state]} — happened {formatInstant(current.occurred_at)},
        reported {formatInstant(current.reported_at)}
      </p>

      <Clocks clocks={current.clocks} />

      <h2>What happened</h2>

      <dl>
        <Field incident={current} name="task_performed" label="Task being performed">
          {current.task_performed}
        </Field>
        <Field incident={current} name="equipment_involved" label="Equipment involved">
          {current.equipment_involved}
        </Field>
        <Field incident={current} name="what_happened" label="What happened">
          {/* Las palabras exactas del reportante, en el idioma en que las escribió. Sin
              traducción: es un registro inmutable (riesgo G). */}
          <span lang={current.narrative_language}>{current.what_happened}</span>
        </Field>
        <Field incident={current} name="body_part" label="Part of the body">
          {BODY_PART_LABELS[current.body_part]}
        </Field>
        <Field incident={current} name="on_site_treatment" label="Treatment at the workplace">
          {TREATMENT_LABELS[current.on_site_treatment]}
        </Field>
        <Field incident={current} name="immediate_action" label="Immediate action taken">
          {current.immediate_action}
        </Field>
      </dl>

      <p>
        {current.witnesses.length === 0
          ? 'No witnesses were recorded.'
          : `Witnesses: ${current.witnesses
              .map((witness) => `${witness.first_name} ${witness.last_name}`)
              .join(', ')}`}
      </p>

      <p>
        <Link to="/incidents/$id/form7" params={{ id }}>
          Show the WSIB Form 7 fields
        </Link>
      </p>

      <h2>History</h2>

      <ol className="list">
        {current.events.map((event) => (
          <li key={event.id} className="list__row">
            <span>
              {INCIDENT_STATE_LABELS[event.to_state]} — {formatInstant(event.occurred_at)}
            </span>
            {event.reason ? <p>Reason: {event.reason}</p> : null}
            {event.note ? <p>{event.note}</p> : null}
          </li>
        ))}
      </ol>

      {current.investigation ? (
        <Investigation incidentId={id} investigation={current.investigation} />
      ) : null}

      <h2>What now</h2>

      {available.some((transition) => transition.to === 'under_investigation' &&
        current.state === 'reported') ? (
        <>
          <label>
            Method
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as typeof method)}
            >
              <option value="five_whys">Five whys</option>
              <option value="cause_tree">Cause tree</option>
            </select>
          </label>

          <label>
            Sequence of events (optional)
            <textarea value={sequence} onChange={(event) => setSequence(event.target.value)} />
          </label>
        </>
      ) : null}

      {available.some((transition) => transition.requires.includes('reason')) ? (
        <label>
          Reason
          <textarea value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
      ) : null}

      {available.map((transition) => (
        <button
          key={`${transition.from ?? 'new'}->${transition.to}`}
          type="button"
          disabled={move.isPending}
          onClick={() => move.mutate(transition)}
        >
          {incidentTransitionLabel(current.state, transition.to)}
        </button>
      ))}

      {available.length === 0 ? (
         <p>Nothing for you to do here: the coordinator moves this one along.</p>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
