import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { getIncident, recordCause } from '../../api/incidents';
import { queryKeys } from '../../api/query-keys';

/** La investigación: método, secuencia, causas y el formulario para agregar una más. */
export function Investigation({
  incidentId,
  investigation,
}: {
  incidentId: string;
  investigation: NonNullable<Awaited<ReturnType<typeof getIncident>>['investigation']>;
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
