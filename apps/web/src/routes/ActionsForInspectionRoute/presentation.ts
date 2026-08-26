import type { ActionState, ActionSummary } from '@hs/contracts';

export type ActionStatusFilter = 'active' | ActionState | 'all';
export type ActionSourceFilter =
  | 'all'
  | 'manual_finding'
  | 'investigation'
  | `template:${string}`;
export type ActionSiteFilter = 'all' | string;

export interface ActionListFilters {
  status: ActionStatusFilter;
  source: ActionSourceFilter;
  site: ActionSiteFilter;
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
}

export function visibleActions(
  actions: readonly ActionSummary[],
  filters: ActionListFilters,
): ActionSummary[] {
  return actions.filter((action) => {
    const matchesStatus =
      filters.status === 'all' ||
      (filters.status === 'active' ? action.state !== 'closed' : action.state === filters.status);
    const matchesSite = filters.site === 'all' || action.site_id === filters.site;
    const matchesSource =
      filters.source === 'all' ||
      (filters.source === 'manual_finding' && action.source.kind === 'manual_finding') ||
      (filters.source === 'investigation' && action.source.kind === 'investigation') ||
      (filters.source.startsWith('template:') &&
        action.source.kind === 'inspection' &&
        action.source.template_id === filters.source.slice('template:'.length));

    return matchesStatus && matchesSite && matchesSource;
  });
}

export function sourceLabel(action: ActionSummary): string {
  if (action.source.kind === 'inspection') return action.source.template_name;
  if (action.source.kind === 'manual_finding') return 'Manual finding';
  return 'Incident investigation';
}

export function sourceOptions(
  actions: readonly ActionSummary[],
): FilterOption<ActionSourceFilter>[] {
  const templates = new Map<string, string>();
  let hasManual = false;
  let hasInvestigation = false;

  for (const action of actions) {
    if (action.source.kind === 'inspection') {
      templates.set(action.source.template_id, action.source.template_name);
    } else if (action.source.kind === 'manual_finding') {
      hasManual = true;
    } else {
      hasInvestigation = true;
    }
  }

  const options: FilterOption<ActionSourceFilter>[] = [{ value: 'all', label: 'All sources' }];
  const templateOptions = [...templates]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([id, name]) => ({ value: `template:${id}` as const, label: name }));

  options.push(...templateOptions);
  if (hasManual) options.push({ value: 'manual_finding', label: 'Manual findings' });
  if (hasInvestigation) options.push({ value: 'investigation', label: 'Incident investigations' });

  return options;
}

/**
 * Si una acción pertenece al grupo de inspección pedido.
 *
 * `'other'` es el valor reservado para las acciones sin inspección
 * (manual finding o investigación) — la fila "Other sources" de la lista de
 * `ActionsRoute`.
 */
export function matchesInspectionGroup(action: ActionSummary, inspectionId: string): boolean {
  if (inspectionId === 'other') return action.source.kind !== 'inspection';
  return action.source.kind === 'inspection' && action.source.inspection_id === inspectionId;
}

export function inspectionGroupLabel(actions: readonly ActionSummary[], inspectionId: string): string {
  if (inspectionId === 'other') return 'Other sources';
  const first = actions.find((action) => matchesInspectionGroup(action, inspectionId));
  return first ? sourceLabel(first) : 'Corrective actions';
}

export function siteOptions(actions: readonly ActionSummary[]): FilterOption<string>[] {
  return [...new Map(actions.map((action) => [action.site_id, action.site_name]))]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .map(([value, label]) => ({ value, label }));
}
