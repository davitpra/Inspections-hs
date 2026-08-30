import type { Finding, ScheduledInspection } from '@hs/contracts';

/**
 * Qué inspecciones cerradas dejaron algo que arreglar.
 *
 * EL CRUCE ES POR `inspection_id`, NO POR EL ID DE LA FILA. Lo que se lista es una
 * inspección PROGRAMADA (`item.id`, el que viaja en la URL), pero un hallazgo apunta al
 * ENVÍO que lo abrió (`item.inspection_id`). Son dos identificadores distintos sobre la
 * misma inspección, y confundirlos no rompe nada: devuelve una lista vacía sin error, que
 * se lee como una planta sin hallazgos.
 *
 * Los hallazgos manuales quedan afuera por construcción: nacen sin inspección
 * (`inspection_id` nulo, y por el CHECK de identidad también sin `item_key`), así que no
 * hay recorrido que abrirles.
 *
 * **Y NO TIENEN NINGUNA OTRA PANTALLA.** Un hallazgo manual queda sin camino de creación en
 * la PWA. `POST /findings/:id/actions` lo sigue aceptando: lo que falta es interfaz, y es una
 * decisión declarada, no un olvido.
 *
 * No reordena: recibe lo que ya ordenó `completedInspections` —lo más reciente primero— y
 * solo recorta. Volver a ordenar acá sería una segunda opinión sobre el mismo criterio.
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
