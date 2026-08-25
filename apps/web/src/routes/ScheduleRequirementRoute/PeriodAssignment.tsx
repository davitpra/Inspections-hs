import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { assignInspector, listInspectorCandidates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';
import { candidateLabel, inspectorLabel } from '../SchedulingRoute/presentation';

/** Control existente de asignación, con confirmación separada y sin actualización optimista. */
export function PeriodAssignment({
  inspection,
  siteId,
  periodLabel,
}: {
  inspection: ScheduledInspection;
  siteId: string;
  periodLabel: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();
  const assigned = inspection.inspector_id ?? '';
  const [chosen, setChosen] = useState(assigned);
  const [error, setError] = useState<string | null>(null);
  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    retry: false,
  });
  const assign = useMutation({
    mutationFn: (inspectorId: string) => assignInspector(inspection.id, inspectorId),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });
    },
    onError: (caught: Error) => {
      setChosen(assigned);
      setError(caught.message);
    },
  });
  const options = candidates.data ?? [];
  const currentListed = options.some((candidate) => candidate.id === inspection.inspector_id);

  return (
    <>
      <td data-label="Inspector">
        <div className="annual-plan__inspector-control">
          <div className="field-select">
            <span className="field-select__icon"><PersonIcon /></span>
            <select
              id={`${controlId}-assign`}
              aria-label={`Assign inspector for ${periodLabel}`}
              value={chosen}
              disabled={assign.isPending}
              onChange={(event) => setChosen(event.target.value)}
            >
              <option value="">No inspector yet</option>
              {inspection.inspector_id !== null && !currentListed ? (
                <option value={inspection.inspector_id}>{inspectorLabel(inspection)}</option>
              ) : null}
              {options.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>
              ))}
            </select>
          </div>
          {candidates.isLoading ? <p className="note">Loading eligible inspectors…</p> : null}
          {candidates.isError ? <p className="notice notice--warn" role="alert">Eligible inspectors could not be loaded.</p> : null}
        </div>
      </td>
      <td data-label="Action" className="annual-plan-row__action-cell">
        <div className="annual-plan__action">
          <button
            type="button"
            className="button--outline"
            disabled={assign.isPending || chosen === '' || chosen === assigned}
            onClick={() => assign.mutate(chosen)}
          >
            {assign.isPending ? 'Assigning…' : 'Confirm assignment'}
          </button>
          {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}
        </div>
      </td>
    </>
  );
}
