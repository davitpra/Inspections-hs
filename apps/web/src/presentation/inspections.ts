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
 * Qué inspecciones completadas puede leer esta cuenta, y en qué orden se leen.
 *
 * `status` ya lo deriva el motor (`period-status.sql.ts`); acá no se vuelve a decidir qué
 * es "completado". El recorte por cuenta sí es del cliente: `GET /scheduled-inspections`
 * devuelve los sitios en alcance —un miembro del JHSC viendo la programación de su sitio es
 * legítimo— y esto reduce la colección a lo propio salvo para cuentas administrativas.
 */
export function completedInspections(
  scheduled: readonly ScheduledInspection[],
  userId: string,
  canReviewAll: boolean,
): ScheduledInspection[] {
  return [...scheduled]
    .filter(
      (item) =>
        item.status === 'completed' && (canReviewAll || item.inspector_id === userId),
    )
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

/**
 * El nombre de una plantilla acomodado DENTRO de una oración: minúscula inicial y plural.
 *
 * Lo comparten el historial y los hallazgos porque las dos pantallas describen sus grupos
 * con una frase que TERMINA en el nombre del tipo ("All completed monthly electrical
 * inspections."). La oración entera no se comparte —cada pantalla dice algo distinto de
 * las mismas filas— y por eso acá vive solo la parte que sí es la misma.
 *
 * Baja SOLO el primer carácter: un nombre puede traer una sigla o el nombre de un sitio, y
 * `toLowerCase()` entero se los comería. El plural es una `s` salvo que ya termine en una:
 * es una regla pobre a propósito, y alcanza porque la UI es solo inglés
 * (`openspec/config.yaml`) y un nombre de plantilla es un título, no texto libre.
 */
export function templateNamePhrase(templateName: string): string {
  if (templateName === '') return '';

  const lowered = templateName.charAt(0).toLowerCase() + templateName.slice(1);

  return lowered.endsWith('s') ? lowered : `${lowered}s`;
}
