import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import type { IncidentTransition, RegulatoryClockDto } from '@hs/contracts';

import { getIncident, recordCause, transitionIncident } from '../api/incidents';
import { queryKeys } from '../api/query-keys';
import { useAppSession } from '../app/session-context';
import {
  BODY_PART_LABELS,
  CLASSIFICATION_LABELS,
  INCIDENT_STATE_LABELS,
  OBLIGATION_LABELS,
  TREATMENT_LABELS,
  availableTransitions,
  clockOrigin,
  clockStatus,
  formatInstant,
  hadField,
  incidentTransitionLabel,
} from './incident-presentation';

/**
 * El detalle de un incidente: qué pasó, qué relojes corren, y qué se puede hacer.
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
        <p>Nothing for you to do here: the HS coordinator moves this one along.</p>
      ) : null}

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}

/**
 * Los relojes regulatorios.
 *
 * **Se muestran, no se cumplen.** Cada uno dice qué hay que hacer, para cuándo, desde
 * cuándo cuenta y de qué artículo sale. El sistema no envía nada al MLITSD ni al WSIB:
 * presentar es un acto de una persona, y por eso la pantalla lo dice con todas las
 * letras en vez de dejarlo implícito.
 *
 * **Un reloj vencido se muestra vencido.** Esconderlo sería peor: quien tiene que
 * responder ante el organismo necesita saberlo hoy.
 */
function Clocks({ clocks }: { clocks: readonly RegulatoryClockDto[] }): React.JSX.Element {
  if (clocks.length === 0) {
    return <p>This classification does not trigger a Ministry or WSIB obligation.</p>;
  }

  return (
    <section>
      <h2>Regulatory clocks</h2>

      <ul className="list">
        {clocks.map((clock) => (
          <li key={clock.obligation} className="list__row">
            <span>
              {OBLIGATION_LABELS[clock.obligation as keyof typeof OBLIGATION_LABELS] ??
                clock.obligation}
            </span>
            <p>
              {clockStatus(clock)} — {clockOrigin(clock)}
              {clock.overdue ? <span className="badge badge--overdue">Past due</span> : null}
            </p>
            <p>{clock.citation}</p>
          </li>
        ))}
      </ul>

      <p className="notice">
        These deadlines are calculated and shown. The platform does not file anything with
        the Ministry or the WSIB — a person does that, in the regulator&apos;s own portal.
      </p>
    </section>
  );
}

/**
 * Un campo, o la constancia de que **no existía en la versión de este incidente**.
 *
 * Es la pregunta cerrada 10 llevada a la pantalla: sin esto, "vacío porque no aplicaba" y
 * "vacío porque el campo no existía" se ven idénticos, y en un registro inmutable esa
 * diferencia no se puede reconstruir después.
 */
function Field({
  incident,
  name,
  label,
  children,
}: {
  incident: { fields_of_version: readonly string[] };
  name: string;
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {hadField(incident as never, name) ? (
          children
        ) : (
          <em>This field did not exist when the incident was written.</em>
        )}
      </dd>
    </>
  );
}

/** La investigación: método, secuencia, causas y el formulario para agregar una más. */
function Investigation({
  incidentId,
  investigation,
}: {
  incidentId: string;
  investigation: NonNullable<
    Awaited<ReturnType<typeof getIncident>>['investigation']
  >;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [statement, setStatement] = useState('');
  const [isRoot, setIsRoot] = useState(false);

  const add = useMutation({
    mutationFn: () => recordCause(incidentId, { statement: statement.trim(), is_root: isRoot }),
    onSuccess: () => {
      setStatement('');
      setIsRoot(false);
      void queryClient.invalidateQueries({ queryKey: queryKeys.incident(incidentId) });
    },
  });

  return (
    <section>
      <h2>Investigation</h2>

      <p>Method: {investigation.method === 'five_whys' ? 'Five whys' : 'Cause tree'}</p>

      {investigation.sequence_of_events ? <p>{investigation.sequence_of_events}</p> : null}

      <ol className="list">
        {investigation.causes.map((cause) => (
          <li key={cause.id} className="list__row">
            <span>
              {cause.statement}
              {cause.is_root ? <strong> — root cause</strong> : null}
            </span>
          </li>
        ))}
      </ol>

      {/* Append-only: corregir una causa es agregar otra. No hay botón de editar y su
          ausencia es la decisión — 0012 no tiene un solo GRANT UPDATE sobre estas filas. */}
      <label>
        Add a cause
        <textarea value={statement} onChange={(event) => setStatement(event.target.value)} />
      </label>

      <label>
        <input
          type="checkbox"
          checked={isRoot}
          onChange={(event) => setIsRoot(event.target.checked)}
        />
        This is the root cause
      </label>

      <button type="button" disabled={add.isPending} onClick={() => add.mutate()}>
        Record the cause
      </button>

      <p>
        Causes are append-only. To correct one, add another: nothing in this record is
        rewritten.
      </p>
    </section>
  );
}
