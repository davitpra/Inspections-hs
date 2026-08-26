import type { ActionSummary } from '@hs/contracts';

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
