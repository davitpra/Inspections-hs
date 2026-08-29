import type { ActionSummary } from '@hs/contracts';

/**
 * Lo puro de la lectura de hallazgos: qué acciones señalan a cada hallazgo, y si el plazo
 * que se escribió en el formulario sirve.
 *
 * Las dos funciones se prueban sin renderizar porque las dos son decisiones —"este
 * hallazgo ya tiene trabajo abierto" y "esta fecha no se puede comprometer"— y una
 * decisión que solo se ve dibujada es una decisión que nadie comprueba.
 */

/**
 * Las acciones correctivas de cada hallazgo, indexadas por el id del hallazgo.
 *
 * **Se agrupa por `source.finding_id` y no por un campo del hallazgo**, porque el hallazgo
 * no tiene ninguno: `findingSchema` no lleva estado ni conteo, y esa ausencia es
 * deliberada —lo que se hizo con un hallazgo son sus acciones, que se leen por su cuenta—.
 * La relación solo existe del lado de la acción.
 *
 * Las acciones de una investigación no tienen `finding_id` y quedan afuera solas: la unión
 * discriminada de `ActionSource` solo lo trae en las variantes `inspection` y
 * `manual_finding`.
 *
 * Devuelve un `Map` y no una lista emparejada con los hallazgos porque esta pantalla ya
 * tiene los hallazgos dibujados en el orden del documento congelado: lo único que le falta
 * es poder preguntar por uno.
 */
export function actionsByFinding(
  actions: readonly ActionSummary[],
): Map<string, ActionSummary[]> {
  const byFinding = new Map<string, ActionSummary[]>();

  for (const action of actions) {
    if (!('finding_id' in action.source)) continue;

    const group = byFinding.get(action.source.finding_id);

    if (group) group.push(action);
    else byFinding.set(action.source.finding_id, [action]);
  }

  return byFinding;
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
