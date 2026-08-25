import type { InspectionSchedule, ScheduledInspection } from '@hs/contracts';

import {
  calendarLabel,
  inspectorLabel,
  missedNote,
  projectYear,
  STATUS_LABELS,
  type YearEntry,
} from '../../presentation/scheduling';

export type RowControl = 'open' | 'assign' | 'read';

/** Proyecta solo una regla; la aritmética sigue siendo la del calendario anual. */
export function requirementYear(
  rule: InspectionSchedule,
  periods: readonly ScheduledInspection[],
  year: string,
): YearEntry[] {
  return projectYear(
    [rule],
    periods.filter((period) => period.site_id === rule.site_id && period.template_id === rule.template_id),
    year,
  );
}

export function periodLabel(entry: YearEntry, year: string): string {
  return entry.kind === 'opened'
    ? calendarLabel(entry.inspection.period_start, entry.inspection.period_months, year)
    : calendarLabel(entry.period.period_start, entry.period.period_months, year);
}

export function periodStatus(entry: YearEntry): string {
  return entry.kind === 'opened' ? STATUS_LABELS[entry.inspection.status] : 'Not opened';
}

export function rowControl(entry: YearEntry, canAdminister: boolean): RowControl {
  if (!canAdminister) return 'read';
  if (entry.kind === 'unopened') return 'open';
  if (entry.inspection.status === 'completed' || entry.inspection.cancelled_at !== null) return 'read';

  return 'assign';
}

export function rowInspector(entry: YearEntry): string {
  return entry.kind === 'opened' ? inspectorLabel(entry.inspection) : 'Not opened yet';
}

export function rowNote(entry: YearEntry): string | null {
  if (entry.kind === 'unopened') return null;
  if (entry.inspection.cancellation_reason) return `Cancelled: ${entry.inspection.cancellation_reason}`;

  return missedNote(entry.inspection);
}

export function entryKey(entry: YearEntry): string {
  return entry.kind === 'opened'
    ? entry.inspection.id
    : `${entry.period.template_id}|${entry.period.period_start}`;
}
