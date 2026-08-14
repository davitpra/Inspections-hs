import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { assignInspector, cancelScheduledInspection, listInspectorCandidates } from '../../api/inspections';
import { candidateLabel } from './presentation';

/**
 * Asignar y cancelar.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA, a propósito. Si el servidor rechaza la asignación —la
 * cuenta perdió el alcance entre que se cargó la lista y se hizo click—, la fila tiene
 * que seguir mostrando al inspector anterior y el motivo tiene que verse. Pintar el
 * cambio y deshacerlo después es peor que esperar.
 */
export function PeriodControls({
  inspection,
  siteId,
}: {
  inspection: ScheduledInspection;
  siteId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const candidates = useQuery({
    queryKey: ['inspector-candidates', siteId],
    queryFn: () => listInspectorCandidates(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['scheduled-inspections'] });
    void queryClient.invalidateQueries({ queryKey: ['pending-inspections'] });
  };

  const assign = useMutation({
    mutationFn: (inspectorId: string) => assignInspector(inspection.id, inspectorId),
    onSuccess: () => {
      setError(null);
      invalidate();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const cancel = useMutation({
    mutationFn: () => cancelScheduledInspection(inspection.id, reason),
    onSuccess: () => {
      setReason('');
      setError(null);
      invalidate();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <>
      {/*
        `htmlFor`/`id` y no un `<label>` que envuelve al control: envolviéndolo, el texto
        accesible de la etiqueta pasa a incluir el de todas las opciones.
      */}
      <label htmlFor={`${controlId}-assign`}>Assign</label>
      <select
        id={`${controlId}-assign`}
        value=""
        disabled={assign.isPending}
        onChange={(event) => {
          if (event.target.value !== '') assign.mutate(event.target.value);
        }}
      >
        <option value="">Choose an inspector…</option>
        {(candidates.data ?? []).map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidateLabel(candidate)}
          </option>
        ))}
      </select>

      <label htmlFor={`${controlId}-reason`}>Cancel with a reason</label>
      <textarea
        id={`${controlId}-reason`}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why this period will not be inspected"
      />

      <button
        type="button"
        onClick={() => cancel.mutate()}
        disabled={reason.trim() === '' || cancel.isPending}
      >
        {cancel.isPending ? 'Cancelling…' : 'Cancel this period'}
      </button>

      <span className="note">Cancelling cannot be undone. The period is scheduled again instead.</span>

      {error ? <p className="notice">{error}</p> : null}
    </>
  );
}
