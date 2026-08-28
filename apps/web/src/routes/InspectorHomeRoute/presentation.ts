import type { PendingInspection, ScheduledInspection } from '@hs/contracts';

import { periodLabel } from '../../presentation/dates';
import { dueIn } from '../../presentation/inspections';
import type { YearEntry } from '../../presentation/scheduling';

export interface ScheduledInspectionRowPresentation {
  inspection: PendingInspection;
  period: string;
  due: string;
}

export interface InspectorSchedulePresentation {
  periods: ScheduledInspection[];
  entries: YearEntry[];
}

export function inspectorSchedule(
  scheduled: readonly ScheduledInspection[],
  userId: string,
  year: string,
): InspectorSchedulePresentation {
  const periods = scheduled.filter((inspection) => inspection.inspector_id === userId);
  const entries: YearEntry[] = periods
    .filter((inspection) => inspection.period_start.slice(0, 4) === year)
    .map((inspection) => ({ kind: 'opened', inspection }));

  return { periods, entries };
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
