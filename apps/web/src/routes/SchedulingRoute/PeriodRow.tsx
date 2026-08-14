import type { ScheduledInspection } from '@hs/contracts';

import { inspectorLabel, isUnassigned, periodLabel, statusClass, STATUS_LABELS } from './presentation';
import { PeriodControls } from './PeriodControls';

export function PeriodRow({
  inspection,
  siteId,
  canAdminister,
}: {
  inspection: ScheduledInspection;
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  return (
    <li className={statusClass(inspection.status)}>
      <span className="period__month">{periodLabel(inspection.period_start)}</span>
      <span className="period__status">{STATUS_LABELS[inspection.status]}</span>
      <span>{inspection.template_name}</span>

      <span className={isUnassigned(inspection) ? 'badge badge--missing' : undefined}>
        {inspectorLabel(inspection)}
      </span>

      {inspection.cancellation_reason ? (
        <span className="period__note">Cancelled: {inspection.cancellation_reason}</span>
      ) : null}

      {canAdminister && inspection.cancelled_at === null ? (
        <PeriodControls inspection={inspection} siteId={siteId} />
      ) : null}
    </li>
  );
}
