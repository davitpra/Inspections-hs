import type { ScheduledInspection } from '@hs/contracts';

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
