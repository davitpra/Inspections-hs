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

/**
 * El tono de la nota de una fila.
 *
 * `warn` es lo que le falta algo a la fila; `info` es lo que solo describe cómo quedó
 * configurada. Van separados porque pintarlos igual gasta el ámbar: si «visible antes de
 * su período» —que es exactamente lo que el coordinador pidió— se lee como advertencia,
 * la advertencia de verdad deja de destacarse.
 */
export interface RowNote {
  text: string;
  tone: 'warn' | 'info';
}

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

export function rowNote(entry: YearEntry, today: string): RowNote | null {
  if (entry.kind === 'unopened') return null;
  if (entry.inspection.cancellation_reason) {
    return { text: `Cancelled: ${entry.inspection.cancellation_reason}`, tone: 'warn' };
  }
  if (entry.inspection.visible_early && entry.inspection.period_start > today) {
    return { text: 'Visible to the inspector ahead of its period', tone: 'info' };
  }

  const missed = missedNote(entry.inspection);

  return missed === null ? null : { text: missed, tone: 'warn' };
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
