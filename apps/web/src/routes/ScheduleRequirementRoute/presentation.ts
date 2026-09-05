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

/** Si la inspección aparece ahora mismo en la lista de pendientes de su inspector. */
export function rowVisibility(entry: YearEntry, today: string): 'Visible' | 'Not visible' {
  if (entry.kind === 'unopened') return 'Not visible';
  if (entry.inspection.inspector_id === null) return 'Not visible';
  if (entry.inspection.cancelled_at !== null || entry.inspection.status === 'completed') return 'Not visible';

  return entry.inspection.period_start <= today || entry.inspection.visible_early
    ? 'Visible'
    : 'Not visible';
}

export function canMakeVisible(
  entry: YearEntry,
  today: string,
  canAdminister: boolean,
): boolean {
  if (!canAdminister || entry.kind === 'unopened') return false;

  return (
    entry.inspection.inspector_id !== null &&
    entry.inspection.cancelled_at === null &&
    entry.inspection.status !== 'completed' &&
    !entry.inspection.visible_early &&
    entry.inspection.period_start > today
  );
}

/**
 * Lo que le FALTA a la fila, y nada más.
 *
 * La nota supo describir también cómo quedó configurada —«visible antes de su período»—
 * y por eso tenía dos tonos. Esa mitad ahora la dice la columna `Visibility` en su propia
 * celda, así que queda un solo tono: la nota es ámbar porque siempre advierte.
 */
export function rowNote(entry: YearEntry): string | null {
  if (entry.kind === 'unopened') return null;
  if (entry.inspection.cancellation_reason) {
    return `Cancelled: ${entry.inspection.cancellation_reason}`;
  }

  return missedNote(entry.inspection);
}

/**
 * El texto del único botón de la fila, o nada.
 *
 * Asignar y reasignar son el mismo control y la misma escritura, pero no la misma
 * decisión: reasignar le SACA el período a alguien que ya lo tiene en su lista de
 * pendientes, y el botón tiene que decirlo antes de que se lo toque.
 */
export function actionLabel(entry: YearEntry, control: RowControl): string | null {
  if (control === 'open') return 'Open period';
  if (control === 'read') return null;

  return entry.kind === 'opened' && entry.inspection.inspector_id !== null
    ? 'Reassign inspector'
    : 'Assign inspector';
}

export function entryKey(entry: YearEntry): string {
  return entry.kind === 'opened'
    ? entry.inspection.id
    : `${entry.period.template_id}|${entry.period.period_start}`;
}
