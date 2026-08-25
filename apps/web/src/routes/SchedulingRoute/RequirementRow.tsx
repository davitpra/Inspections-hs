import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  PERIOD_MONTHS_LABELS,
  type InspectionSchedule,
  type UpdateInspectionSchedule,
} from '@hs/contracts';

import { updateSchedule } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { RowMenu } from '../../components/RowMenu';

export function RequirementRow({
  rule,
  canAdminister,
  onConfirm,
}: {
  rule: InspectionSchedule;
  canAdminister: boolean;
  /** Lo que confirma no se resuelve acá: la fila desaparece al aplicarse (ver `RequirementConfirmDialog`). */
  onConfirm: (kind: 'deactivate' | 'archive') => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const active = rule.deactivated_at === null;
  const archived = rule.archived_at !== null;
  const update = useMutation({
    mutationFn: (body: UpdateInspectionSchedule) => updateSchedule(rule.id, body),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inspectionSchedules() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const actions = archived
    ? [{ label: 'Restore', onSelect: () => { setError(null); update.mutate({ archived: false }); } }]
    : active
      ? [{ label: 'Deactivate requirement', tone: 'danger' as const, onSelect: () => onConfirm('deactivate') }]
      : [
          { label: 'Reactivate requirement', onSelect: () => update.mutate({ deactivated: false }) },
          { label: 'Archive requirement', onSelect: () => onConfirm('archive') },
        ];
  const status = archived ? 'Archived' : active ? 'Active' : 'Deactivated';

  return (
    <tr className="requirement-row">
      <th scope="row" data-label="Requirement"><strong>{rule.template_name}</strong></th>
      <td data-label="Frequency" className="requirement-row__cadence">{PERIOD_MONTHS_LABELS[rule.frequency_months]}</td>
      <td data-label="Default inspector">{rule.default_inspector_name ?? 'None'}</td>
      <td data-label="Status"><span className={!archived && active ? 'status-pill status-pill--open' : 'status-pill status-pill--cancelled'}>{status}</span></td>
      {canAdminister ? (
        <td data-label="Actions" className="requirements-table__actions-cell">
          <div className="table__actions">
            <RowMenu label={`More actions for ${rule.template_name}`} actions={actions} />
          </div>
          {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}
        </td>
      ) : null}
    </tr>
  );
}
