import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { InspectionSchedule } from '@hs/contracts';

import { createScheduledInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { PeriodAssignment } from './PeriodAssignment';
import { entryKey, periodLabel, periodStatus, rowControl, rowInspector, rowNote } from './presentation';
import type { YearEntry } from '../SchedulingRoute/presentation';

export function RequirementPeriodRow({
  entry,
  rule,
  year,
  canAdminister,
  publishedVersion,
}: {
  entry: YearEntry;
  rule: InspectionSchedule;
  year: string;
  canAdminister: boolean;
  publishedVersion: number | null;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const control = rowControl(entry, canAdminister);
  const [error, setError] = useState<string | null>(null);
  const open = useMutation({
    mutationFn: () => {
      if (entry.kind !== 'unopened') throw new Error('This period is already open');
      return createScheduledInspection({
        site_id: entry.period.site_id,
        template_id: entry.period.template_id,
        period_start: entry.period.period_start,
      });
    },
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });
    },
    onError: (caught: Error) => setError(caught.message),
  });
  const opened = entry.kind === 'opened' ? entry.inspection : null;
  const note = rowNote(entry);
  const label = periodLabel(entry, year);

  return (
    <tr key={entryKey(entry)} className={`annual-plan-row annual-plan-row--${control}`}>
      <th scope="row" data-label="Period">
        <span className="annual-plan-row__period">{label}</span>
      </th>
      <td data-label="Status" className="annual-plan-row__status-cell">
        <span className={`annual-plan-row__status status-pill status-pill--${statusClassName(entry)}`}>{periodStatus(entry)}</span>
        {note ? <span className="annual-plan-row__note">{note}</span> : null}
      </td>
      {control === 'open' ? (
        <>
          <td data-label="Inspector"><span className="note">Not assigned yet</span></td>
          <td data-label="Action" className="annual-plan-row__action-cell">
            <div className="annual-plan__action">
              <span className="note">
                {publishedVersion === null ? 'Published version unavailable' : `Freezes version ${publishedVersion}`}
              </span>
              <button
                type="button"
                className="button--outline"
                aria-label={`Open ${label}`}
                disabled={open.isPending || publishedVersion === null}
                onClick={() => open.mutate()}
              >
                {open.isPending ? 'Opening…' : 'Open period'}
              </button>
              {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}
            </div>
          </td>
        </>
      ) : control === 'assign' && opened ? (
        <PeriodAssignment inspection={opened} siteId={rule.site_id} periodLabel={label} />
      ) : (
        <>
          <td data-label="Inspector"><span>{rowInspector(entry)}</span></td>
          <td data-label="Action" className="annual-plan-row__action-cell"><span className="note">None</span></td>
        </>
      )}
    </tr>
  );
}

function statusClassName(entry: YearEntry): string {
  if (entry.kind === 'unopened') return 'not-opened';
  if (entry.inspection.cancelled_at !== null) return 'cancelled';
  return entry.inspection.status;
}
