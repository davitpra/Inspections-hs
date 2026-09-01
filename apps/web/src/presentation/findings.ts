import type { Finding, ScheduledInspection } from '@hs/contracts';

/** Cuántas fotos acompañan a un hallazgo, dicho como se lee en pantalla. */
export function photoCountText(count: number): string {
  if (count === 0) return 'No photos';

  return count === 1 ? '1 photo' : `${count} photos`;
}

/** Cuántos hallazgos abrió una sección. */
export function findingsLabel(count: number): string {
  return count === 1 ? '1 finding' : `${count} findings`;
}

/**
 * Qué inspecciones cerradas dejaron algo que arreglar.
 *
 * El cruce es por `inspection_id`, el id del envío que referencia el hallazgo, y no por el
 * id de la inspección programada que viaja en la URL. Los hallazgos manuales quedan afuera
 * porque no tienen envío. No reordena: conserva el orden de `completedInspections`.
 */
export function inspectionsWithFindings(
  completed: readonly ScheduledInspection[],
  findings: readonly Finding[],
): ScheduledInspection[] {
  const withFindings = new Set(
    findings
      .map((finding) => finding.inspection_id)
      .filter((id): id is string => id !== null),
  );

  return completed.filter(
    (item) => item.inspection_id !== null && withFindings.has(item.inspection_id),
  );
}
