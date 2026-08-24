import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { InspectionSchedule } from '@hs/contracts';

import { listInspectorCandidates, updateSchedule } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { RowMenu } from '../../components/RowMenu';
import { candidateLabel, frequencyNote } from './presentation';

export function RequirementRow({
  rule,
  siteId,
  canAdminister,
}: {
  rule: InspectionSchedule;
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<'deactivate' | 'inspector' | null>(null);
  const [inspectorId, setInspectorId] = useState(rule.default_inspector_id ?? '');
  const [error, setError] = useState<string | null>(null);
  const active = rule.deactivated_at === null;
  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    enabled: canAdminister && dialog === 'inspector',
    retry: false,
  });
  const update = useMutation({
    mutationFn: (body: { default_inspector_id?: string | null; deactivated?: boolean }) => updateSchedule(rule.id, body),
    onSuccess: () => {
      setError(null);
      setDialog(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inspectionSchedules() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const actions = active
    ? [
        { label: 'Change default inspector', onSelect: () => setDialog('inspector') },
        { label: 'Deactivate requirement', tone: 'danger' as const, onSelect: () => setDialog('deactivate') },
      ]
    : [{ label: 'Reactivate requirement', onSelect: () => update.mutate({ deactivated: false }) }];

  return (
    <li className="requirement-row">
      <div className="requirement-row__identity"><strong>{rule.template_name}</strong><span className={active ? 'status-pill status-pill--open' : 'status-pill status-pill--cancelled'}>{active ? 'Active' : 'Deactivated'}</span></div>
      <span className="requirement-row__cadence">{frequencyNote(rule).replace(' — to change it, deactivate this rule and create another', '')}</span>
      <span className="requirement-row__inspector">Default inspector: {rule.default_inspector_name ?? 'None'}</span>
      {canAdminister ? <RowMenu label={`More actions for ${rule.template_name}`} actions={actions} /> : null}

      {dialog === 'inspector' ? (
        <dialog open className="inline-dialog" aria-label="Change default inspector" onKeyDown={(event) => { if (event.key === 'Escape') setDialog(null); }}>
          <h3>Change default inspector</h3>
          {candidates.isLoading ? <p className="note">Loading eligible inspectors…</p> : null}
          {candidates.isError ? <p className="notice notice--warn">Eligible inspectors could not be loaded.</p> : null}
          {!candidates.isLoading && !candidates.isError && candidates.data?.length === 0 ? <p className="note">No eligible inspectors are available.</p> : null}
          <select aria-label="Default inspector" value={inspectorId} disabled={candidates.isLoading || candidates.isError || update.isPending} onChange={(event) => setInspectorId(event.target.value)}>
            <option value="">None</option>
            {rule.default_inspector_id !== null && !(candidates.data ?? []).some((candidate) => candidate.id === rule.default_inspector_id) ? <option value={rule.default_inspector_id}>{rule.default_inspector_name ?? 'Assigned (name not visible from this site)'}</option> : null}
            {(candidates.data ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>)}
          </select>
          {error ? <p className="notice notice--warn">{error}</p> : null}
          <div className="modal__actions"><button type="button" className="button--primary" disabled={candidates.isLoading || candidates.isError || update.isPending} onClick={() => update.mutate({ default_inspector_id: inspectorId || null })}>Save inspector</button><button type="button" onClick={() => setDialog(null)}>Cancel</button></div>
        </dialog>
      ) : null}
      {dialog === 'deactivate' ? (
        <dialog open className="inline-dialog" aria-label="Deactivate requirement" onKeyDown={(event) => { if (event.key === 'Escape') setDialog(null); }}>
          <h3>Deactivate {rule.template_name}?</h3>
          <p>No future period will be opened from this requirement. Periods already opened remain unchanged.</p>
          {error ? <p className="notice notice--warn">{error}</p> : null}
          <div className="modal__actions"><button type="button" className="button--danger" disabled={update.isPending} onClick={() => update.mutate({ deactivated: true })}>Deactivate requirement</button><button type="button" onClick={() => setDialog(null)}>Keep active</button></div>
        </dialog>
      ) : null}
    </li>
  );
}
