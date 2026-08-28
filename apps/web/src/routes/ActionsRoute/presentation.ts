import type { ActionSummary, Finding } from '@hs/contracts';

export interface FindingActionRow {
  finding: Finding;
  actionCount: number;
}

/** Conserva todos los hallazgos y cuenta las acciones que señalan a cada uno. */
export function findingsWithActionCounts(
  findings: readonly Finding[],
  actions: readonly ActionSummary[],
): FindingActionRow[] {
  const counts = new Map<string, number>();

  for (const action of actions) {
    if ('finding_id' in action.source) {
      counts.set(action.source.finding_id, (counts.get(action.source.finding_id) ?? 0) + 1);
    }
  }

  return findings
    .map((finding) => ({ finding, actionCount: counts.get(finding.id) ?? 0 }))
    .sort(
      (left, right) =>
        right.finding.occurred_at.localeCompare(left.finding.occurred_at) ||
        left.finding.id.localeCompare(right.finding.id),
    );
}

export type DueAtResult =
  | { success: true; dueAt: string }
  | { success: false; message: string };

/** Convierte el valor local del navegador a un instante ISO y comprueba el plazo al enviar. */
export function futureDueAt(value: string, now: Date): DueAtResult {
  const instant = new Date(value);

  if (value === '' || Number.isNaN(instant.getTime())) {
    return { success: false, message: 'Choose a valid deadline.' };
  }

  if (instant.getTime() <= now.getTime()) {
    return { success: false, message: 'Deadline must be in the future.' };
  }

  return { success: true, dueAt: instant.toISOString() };
}

export interface InspectionActionGroup {
  /** El `inspection_id` del grupo, o `'other'` para lo que no cuelga de ninguna inspección. */
  id: string;
  templateName: string;
  /** `null` en el grupo `'other'`: puede mezclar sitios. */
  siteName: string | null;
  total: number;
  active: number;
  overdue: number;
  /** El `due_at` más próximo entre las acciones activas, o `null` si no hay ninguna. */
  earliestActiveDueAt: string | null;
}

const OTHER_GROUP_ID = 'other';

/**
 * Agrupa las acciones por la inspección de la que salieron, y junta el resto
 * (manual findings, investigaciones) en un único grupo `'other'`.
 *
 * Ordenadas por el vencimiento más próximo de trabajo activo, que es el mismo
 * criterio que ya usa el listado plano — y el grupo `'other'` siempre último,
 * porque mezcla fuentes y no representa una sola inspección que revisar.
 */
export function groupActionsByInspection(
  actions: readonly ActionSummary[],
): InspectionActionGroup[] {
  const byId = new Map<string, ActionSummary[]>();

  for (const action of actions) {
    const id = action.source.kind === 'inspection' ? action.source.inspection_id : OTHER_GROUP_ID;
    const group = byId.get(id);
    if (group) group.push(action);
    else byId.set(id, [action]);
  }

  const groups = [...byId.entries()].map(([id, groupActions]) => {
    const first = groupActions[0]!;
    const activeDueDates = groupActions
      .filter((item) => item.state !== 'closed')
      .map((item) => item.due_at)
      .sort();

    return {
      id,
      templateName:
        id === OTHER_GROUP_ID
          ? 'Other sources'
          : (first.source as Extract<ActionSummary['source'], { kind: 'inspection' }>).template_name,
      siteName: id === OTHER_GROUP_ID ? null : first.site_name,
      total: groupActions.length,
      active: groupActions.filter((item) => item.state !== 'closed').length,
      overdue: groupActions.filter((item) => item.overdue && item.state !== 'closed').length,
      earliestActiveDueAt: activeDueDates[0] ?? null,
    };
  });

  return groups.sort((left, right) => {
    if (left.id === OTHER_GROUP_ID) return 1;
    if (right.id === OTHER_GROUP_ID) return -1;
    if (left.earliestActiveDueAt === null) return right.earliestActiveDueAt === null ? 0 : 1;
    if (right.earliestActiveDueAt === null) return -1;
    return left.earliestActiveDueAt.localeCompare(right.earliestActiveDueAt);
  });
}
