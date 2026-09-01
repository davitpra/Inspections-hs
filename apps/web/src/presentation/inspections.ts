import type { ScheduledInspection } from '@hs/contracts';

import type { DraftRow } from '../offline/db';

/** Si el paquete de campo está listo, todavía no, o la lectura local no resolvió. */
export type Readiness = 'ready' | 'not-ready' | 'unknown';

export function readiness(missing: readonly string[] | undefined): Readiness {
  if (missing === undefined) return 'unknown';

  return missing.length === 0 ? 'ready' : 'not-ready';
}

/** Cuánto falta o hace que pasó un plazo, en días. `today` es el día civil de la planta. */
export function dueIn(periodEnd: string, today: string): string {
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  const days = Math.round((end - now) / 86_400_000);

  if (days === 0) return 'Due today';
  if (days > 0) return `in ${days} day${days === 1 ? '' : 's'}`;

  const overdueDays = -days;
  return `${overdueDays} day${overdueDays === 1 ? '' : 's'} overdue`;
}

export type AssignmentAction = 'none' | 'download' | 'start' | 'resume' | 'open';

export interface AssignmentState {
  action: AssignmentAction;
  actionLabel: string;
  /** La pantalla destacada puede ofrecer esta preparación secundaria; las listas no. */
  showsRefresh: boolean;
  pillLabel: string;
  pillClass: string;
}

/**
 * Si la acción decidida entra a la captura. Se pregunta acá y no en cada superficie
 * porque las dos que la ofrecen —la fila de la pantalla de inicio y la asignación
 * destacada— tienen que abrir en los mismos casos.
 */
export function opensCapture(action: AssignmentAction): boolean {
  return action === 'start' || action === 'resume' || action === 'open';
}

const OVERDUE_PILL = {
  pillLabel: 'Overdue',
  pillClass: 'status-pill status-pill--overdue',
};

/** La píldora y la acción de una asignación, decididas una vez para todas sus superficies. */
export function assignmentState({
  readiness: state,
  overdue,
  draftStatus,
}: {
  readiness: Readiness;
  overdue: boolean;
  draftStatus: DraftRow['status'] | null;
}): AssignmentState {
  if (state === 'unknown') {
    return {
      action: 'none',
      actionLabel: '',
      showsRefresh: false,
      ...(overdue ? OVERDUE_PILL : { pillLabel: '', pillClass: '' }),
    };
  }

  if (draftStatus === 'signed') {
    return {
      action: 'open',
      actionLabel: 'Open inspection',
      showsRefresh: true,
      ...(overdue
        ? OVERDUE_PILL
        : {
            pillLabel: 'Signed, waiting to send',
            pillClass: 'status-pill status-pill--signed',
          }),
    };
  }

  if (draftStatus === 'capturing') {
    return {
      action: 'resume',
      actionLabel: 'Resume inspection',
      showsRefresh: true,
      ...(overdue
        ? OVERDUE_PILL
        : {
            pillLabel: 'In progress',
            pillClass: 'status-pill status-pill--draft',
          }),
    };
  }

  if (state === 'not-ready') {
    return {
      action: 'download',
      actionLabel: 'Download for the field',
      showsRefresh: false,
      ...(overdue
        ? OVERDUE_PILL
        : {
            pillLabel: 'Needs downloading',
            pillClass: 'status-pill status-pill--not-ready',
          }),
    };
  }

  return {
    action: 'start',
    actionLabel: 'Start inspection',
    showsRefresh: true,
    ...(overdue
      ? OVERDUE_PILL
      : {
          pillLabel: 'Ready to start',
          pillClass: 'status-pill status-pill--ready',
        }),
  };
}

/**
 * Qué inspecciones de la planta son "las que cerré yo", y en qué orden se leen.
 *
 * `status` ya lo deriva el motor (`period-status.sql.ts`); acá no se vuelve a decidir qué
 * es "completado". El recorte por cuenta sí es del cliente: `GET /scheduled-inspections`
 * devuelve la planta entera —un miembro del JHSC viendo la programación de su sitio es
 * legítimo— y esto es lo que la reduce a lo propio.
 */
export function completedInspections(
  scheduled: readonly ScheduledInspection[],
  userId: string,
): ScheduledInspection[] {
  return [...scheduled]
    .filter((item) => item.inspector_id === userId && item.status === 'completed')
    .sort((a, b) => b.period_start.localeCompare(a.period_start));
}

export interface InspectionTypeGroup {
  templateId: string;
  templateName: string;
  inspections: readonly ScheduledInspection[];
}

/** Agrupa por la identidad estable del tipo; la entrada más reciente aporta su nombre. */
export function inspectionTypeGroups(
  inspections: readonly ScheduledInspection[],
): InspectionTypeGroup[] {
  const groups = new Map<
    string,
    Omit<InspectionTypeGroup, 'inspections'> & { inspections: ScheduledInspection[] }
  >();

  for (const inspection of inspections) {
    const existing = groups.get(inspection.template_id);

    if (existing) {
      existing.inspections.push(inspection);
      continue;
    }

    groups.set(inspection.template_id, {
      templateId: inspection.template_id,
      templateName: inspection.template_name,
      inspections: [inspection],
    });
  }

  return [...groups.values()].sort((left, right) =>
    left.templateName.localeCompare(right.templateName),
  );
}

/** Conserva el orden cronológico que ya decidió `completedInspections`. */
export function inspectionHistoryForType(
  inspections: readonly ScheduledInspection[],
  templateId: string,
): ScheduledInspection[] {
  return inspections.filter((inspection) => inspection.template_id === templateId);
}
