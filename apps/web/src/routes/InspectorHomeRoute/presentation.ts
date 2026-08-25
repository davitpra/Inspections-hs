import type { PendingInspection } from '@hs/contracts';

import type { DraftRow } from '../../offline/db';
import { DiscardRefusedError, type DiscardRefusal } from '../../offline/drafts';
import { periodLabel } from '../../presentation/dates';
import { dueIn } from '../../presentation/inspections';

export interface ScheduledInspectionRowPresentation {
  inspection: PendingInspection;
  period: string;
  due: string;
}

/** Presenta cada fila sin alterar el orden de urgencia que decidió el servidor. */
export function scheduledInspectionRows(
  inspections: readonly PendingInspection[],
  today: string,
): ScheduledInspectionRowPresentation[] {
  return inspections.map((inspection) => ({
    inspection,
    period: periodLabel(inspection.period_start, inspection.period_months),
    due: dueIn(inspection.period_end, today),
  }));
}

export function draftPeriodStart(
  draft: Pick<DraftRow, 'scheduled_inspection_id'>,
  pending: readonly PendingInspection[],
): string | null {
  return pending.find((item) => item.id === draft.scheduled_inspection_id)?.period_start ?? null;
}

export function draftPillClass(status: DraftRow['status']): string {
  if (status === 'accepted') return 'status-pill status-pill--completed';

  return status === 'signed'
    ? 'status-pill status-pill--signed'
    : 'status-pill status-pill--draft';
}

export function pendingWork(drafts: DraftRow[]): DraftRow[] {
  return drafts.filter((draft) => draft.status !== 'accepted');
}

export function discardRefusalMessage(error: unknown): string {
  const reason: DiscardRefusal | 'unknown' =
    error instanceof DiscardRefusedError ? error.reason : 'unknown';

  switch (reason) {
    case 'not_owner':
      return 'This draft belongs to another account on this device. Sign in as its owner to discard it.';
    case 'already_signed':
    case 'already_queued':
      return 'This inspection is signed and waiting to be sent. It cannot be discarded — it is on its way.';
    default:
      return 'The draft could not be discarded. It is still on this device.';
  }
}

export function statusLabel(status: DraftRow['status']): string {
  if (status === 'accepted') return 'Submitted';
  if (status === 'signed') return 'Signed, waiting to send';

  return 'Draft';
}
