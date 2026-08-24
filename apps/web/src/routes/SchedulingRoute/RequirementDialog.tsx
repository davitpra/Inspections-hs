import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import { PERIOD_MONTHS, PERIOD_MONTHS_LABELS, type InspectionSchedule, type PeriodMonths } from '@hs/contracts';

import { createSchedule, listInspectorCandidates, listTemplates } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { candidateLabel, frequencyNote } from './presentation';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function RequirementDialog({
  siteId,
  rules,
  onClose,
}: {
  siteId: string;
  rules: readonly InspectionSchedule[];
  onClose: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const queryClient = useQueryClient();
  const id = useId();
  const [templateId, setTemplateId] = useState('');
  const [frequencyMonths, setFrequencyMonths] = useState<PeriodMonths>(1);
  const [anchorMonth, setAnchorMonth] = useState('');
  const [inspectorId, setInspectorId] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const close = () => {
    dialogRef.current?.close();
    returnFocusRef.current?.focus();
  };

  const templates = useQuery({ queryKey: queryKeys.templates(), queryFn: listTemplates, retry: false });
  const candidates = useQuery({
    queryKey: queryKeys.inspectorCandidates(siteId),
    queryFn: () => listInspectorCandidates(siteId),
    enabled: siteId !== '',
    retry: false,
  });

  const activeTemplateIds = new Set(rules.filter((rule) => rule.deactivated_at === null).map((rule) => rule.template_id));
  const available = (templates.data ?? []).filter((template) => !activeTemplateIds.has(template.id));
  const selected = available.find((template) => template.id === templateId);
  const canSubmit = Boolean(selected) && !templates.isLoading && !templates.isError;

  const create = useMutation({
    mutationFn: () => createSchedule({
      site_id: siteId,
      template_id: templateId,
      frequency_months: frequencyMonths,
      ...(frequencyMonths !== 1 && anchorMonth !== '' ? { anchor_month: Number(anchorMonth) } : {}),
      ...(inspectorId !== '' ? { default_inspector_id: inspectorId } : {}),
    }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.inspectionSchedules() });
      close();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const cadence = frequencyMonths === 1
    ? 'One period begins every month.'
    : `Periods begin in ${MONTHS[Number(anchorMonth || 1) - 1]} and repeat every ${frequencyMonths} months: ${MONTHS.filter((_, index) => (index + 1 - Number(anchorMonth || 1) + 12) % frequencyMonths === 0).join(', ')}.`;

  return (
    <dialog ref={dialogRef} className="modal requirement-dialog" aria-label="Add requirement" onClose={() => { onClose(); returnFocusRef.current?.focus(); }}>
      <div className="modal__head"><h2>Add requirement</h2></div>
      <p className="modal__text">Choose a published template and the cadence this site must follow.</p>

      {templates.isLoading ? <p className="notice">Loading published templates…</p> : null}
      {templates.isError ? <p className="notice notice--warn">Published templates could not be loaded. Try again when you have a connection.</p> : null}
      {templates.isSuccess && available.length === 0 ? <p className="notice">Every published template already has an active requirement here.</p> : null}

      {templates.isSuccess && available.length > 0 ? (
        <div className="modal__form">
          <label htmlFor={`${id}-template`}>Template</label>
          <select id={`${id}-template`} value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            <option value="">Choose a template…</option>
            {available.map((template) => <option key={template.id} value={template.id}>{template.name} (v{template.latest_version})</option>)}
          </select>
          <label htmlFor={`${id}-frequency`}>Frequency</label>
          <select id={`${id}-frequency`} value={frequencyMonths} onChange={(event) => {
            const next = Number(event.target.value) as PeriodMonths;
            setFrequencyMonths(next);
            if (next === 1) setAnchorMonth('');
          }}>
            {PERIOD_MONTHS.map((months) => <option key={months} value={months}>{PERIOD_MONTHS_LABELS[months]}</option>)}
          </select>
          {frequencyMonths === 1 ? null : (
            <>
              <label htmlFor={`${id}-anchor`}>Starting month</label>
              <select id={`${id}-anchor`} value={anchorMonth} onChange={(event) => setAnchorMonth(event.target.value)}>
                <option value="">Choose a month…</option>
                {MONTHS.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
              </select>
            </>
          )}
          <label htmlFor={`${id}-inspector`}>Default inspector (optional)</label>
          {candidates.isLoading ? <p className="note">Loading eligible inspectors…</p> : null}
          {candidates.isError ? <p className="notice notice--warn">Eligible inspectors could not be loaded. You can continue without a default inspector.</p> : null}
          {!candidates.isLoading && !candidates.isError && candidates.data?.length === 0 ? <p className="note">No eligible inspectors are available.</p> : null}
          <select id={`${id}-inspector`} value={inspectorId} disabled={candidates.isLoading || candidates.isError} onChange={(event) => setInspectorId(event.target.value)}>
            <option value="">None</option>
            {(candidates.data ?? []).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidateLabel(candidate)}</option>)}
          </select>
          {selected ? <p className="requirement-dialog__preview"><strong>Cadence preview:</strong> {cadence}</p> : null}
          <p className="note">{frequencyNote({ frequency_months: frequencyMonths, anchor_month: Number(anchorMonth || 1) })}</p>
        </div>
      ) : null}

      {error ? <p className="notice notice--warn">{error}</p> : null}
      <div className="modal__actions">
        <button type="button" className="button--primary" disabled={!canSubmit || (frequencyMonths !== 1 && anchorMonth === '') || create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? 'Adding…' : 'Add requirement'}
        </button>
        <button type="button" onClick={close}>Cancel</button>
      </div>
    </dialog>
  );
}
