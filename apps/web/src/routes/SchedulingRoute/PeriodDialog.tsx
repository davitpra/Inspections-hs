import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { assignInspector, createScheduledInspection, listInspectorCandidates, listTemplates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { PersonIcon } from '../../components/icons';
import { calendarLabel, candidateLabel, inspectorLabel, missedNote, STATUS_LABELS, type YearEntry } from './presentation';
import { CancelPeriodDialog } from './CancelPeriodDialog';
import { ReopenPeriodDialog } from './ReopenPeriodDialog';

export function PeriodDialog({
  entry,
  year,
  siteId,
  canAdminister,
  onClose,
}: {
  entry: YearEntry;
  year: string;
  siteId: string;
  canAdminister: boolean;
  onClose: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState(entry.kind === 'opened' ? entry.inspection.inspector_id ?? '' : '');
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const inspection = entry.kind === 'opened' ? entry.inspection : null;
  const cancelled = inspection ? inspection.cancelled_at !== null : false;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const close = () => {
    dialogRef.current?.close();
    returnFocusRef.current?.focus();
  };

  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    enabled: canAdminister && siteId !== '' && (entry.kind === 'unopened' || !cancelled),
    retry: false,
  });
  const templates = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    enabled: entry.kind === 'unopened',
    retry: false,
  });

  const template = entry.kind === 'unopened'
    ? templates.data?.find((option) => option.id === entry.period.template_id)
    : null;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
    void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });
  };

  const open = useMutation({
    mutationFn: () => {
      if (entry.kind !== 'unopened') throw new Error('This period is already open.');
      return createScheduledInspection({
        site_id: entry.period.site_id,
        template_id: entry.period.template_id,
        period_start: entry.period.period_start,
        inspector_id: chosen === '' ? null : chosen,
      });
    },
    onSuccess: () => { setError(null); invalidate(); close(); },
    onError: (caught: Error) => setError(caught.message),
  });

  const persisted = inspection?.inspector_id ?? '';
  const assign = useMutation({
    mutationFn: (inspectorId: string) => {
      if (!inspection) throw new Error('This period is not open.');
      return assignInspector(inspection.id, inspectorId);
    },
    onSuccess: () => { setError(null); invalidate(); },
    onError: (caught: Error) => { setChosen(persisted); setError(caught.message); },
  });

  const candidatesFailed = canAdminister && candidates.isError;
  const title = entry.kind === 'opened'
    ? calendarLabel(entry.inspection.period_start, entry.inspection.period_months, year)
    : calendarLabel(entry.period.period_start, entry.period.period_months, year);
  const name = entry.kind === 'opened' ? entry.inspection.template_name : entry.period.template_name;

  return (
    <>
      <dialog ref={dialogRef} className="modal period-dialog" aria-label={`${title} period details`} onClose={() => { onClose(); returnFocusRef.current?.focus(); }}>
        <div className="modal__head"><h2>{title}</h2></div>
        <p className="modal__text">{name}</p>

        {inspection ? (
          <div className="period-dialog__details">
            <div><span className="field-label">Status</span><span className={`status-pill status-pill--${inspection.status}`}>{STATUS_LABELS[inspection.status]}</span></div>
            <div><span className="field-label">Inspector</span><span>{inspectorLabel(inspection)}</span></div>
            {inspection.cancellation_reason ? <div><span className="field-label">Cancellation reason</span><span>{inspection.cancellation_reason}</span></div> : null}
            {missedNote(inspection) ? <p className="notice notice--warn">{missedNote(inspection)}</p> : null}
            {inspection.cancelled_at ? <p className="note">This period can be scheduled again as a new inspection; the cancellation stays on the record.</p> : null}
            {canAdminister && !cancelled ? (
              <div className="period-dialog__assign">
                <label htmlFor={`${id}-assign`}>Inspector</label>
                {candidates.isLoading ? <p className="note">Loading eligible inspectors…</p> : null}
                {candidates.isError ? <p className="notice notice--warn">Eligible inspectors could not be loaded. Assignment is unavailable.</p> : null}
                {!candidates.isLoading && !candidates.isError && candidates.data?.length === 0 ? <p className="note">No eligible inspectors are available.</p> : null}
                <div className="field-select"><PersonIcon /><select id={`${id}-assign`} value={chosen} disabled={candidatesFailed || candidates.isLoading || assign.isPending} onChange={(event) => setChosen(event.target.value)}>
                  <option value="">No inspector yet</option>
                  {inspection.inspector_id !== null && !(candidates.data ?? []).some((candidate) => candidate.id === inspection.inspector_id) ? <option value={inspection.inspector_id}>{inspectorLabel(inspection)}</option> : null}
                  {(candidates.data ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>)}
                </select></div>
                <button type="button" className="button--outline" disabled={candidatesFailed || candidates.isLoading || assign.isPending || chosen === '' || chosen === persisted} onClick={() => assign.mutate(chosen)}>{assign.isPending ? 'Assigning…' : inspection.inspector_id === null ? 'Confirm assignment' : 'Confirm inspector change'}</button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="period-dialog__details">
            <div><span className="field-label">Status</span><span className="status-pill status-pill--not-opened">Not opened</span></div>
            <div><span className="field-label">Published version</span><span>{templates.isLoading ? 'Loading…' : templates.isError ? 'Unavailable' : template ? `Version ${template.latest_version} will be frozen when opened.` : 'No published version is available.'}</span></div>
            {candidates.isLoading ? <p className="note">Loading eligible inspectors…</p> : null}
            {candidates.isError ? <p className="notice notice--warn">Eligible inspectors could not be loaded. You can open this period without assigning a default inspector.</p> : null}
            {canAdminister ? <><label htmlFor={`${id}-open-inspector`}>Inspector (optional)</label><select id={`${id}-open-inspector`} value={chosen} disabled={candidates.isLoading || candidates.isError || open.isPending} onChange={(event) => setChosen(event.target.value)}><option value="">No inspector yet</option>{(candidates.data ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>)}</select></> : null}
          </div>
        )}

        {error ? <p className="notice notice--warn">{error}</p> : null}
        <div className="modal__actions">
          {canAdminister && entry.kind === 'unopened' ? <button type="button" className="button--primary" disabled={templates.isLoading || templates.isError || !template || open.isPending} onClick={() => open.mutate()}>{open.isPending ? 'Opening…' : 'Open this period'}</button> : null}
          {canAdminister && inspection && !cancelled ? <button type="button" className="button--danger" onClick={() => setCancelOpen(true)}>Cancel period</button> : null}
          {canAdminister && inspection && cancelled ? <button type="button" className="button--primary" onClick={() => setReopenOpen(true)}>Schedule this period again</button> : null}
          <button type="button" onClick={close}>Close</button>
        </div>
      </dialog>
      {cancelOpen && inspection ? <CancelPeriodDialog inspection={inspection} onClose={() => setCancelOpen(false)} /> : null}
      {reopenOpen && inspection ? <ReopenPeriodDialog inspection={inspection} siteId={siteId} onClose={() => setReopenOpen(false)} /> : null}
    </>
  );
}
