import type { AnswerSet } from './answers.js';
import type { Condition, VisibleWhen } from './conditions.js';
import { sectionsInDocumentOrder, type TemplateDocument } from './schema.js';

/**
 * Evaluación de la lógica condicional. Función pura: el documento y las
 * respuestas son las únicas entradas. Sin red, sin base, sin reloj — es lo que
 * permite que el dispositivo sin señal y el servidor lleguen al mismo resultado
 * (ADR-007).
 */

/** Si un ítem se muestra o no, por `item_key`. */
export type VisibilityMap = Readonly<Record<string, boolean>>;

/**
 * Una respuesta cuenta como dada cuando no está vacía. `false` y `0` son
 * respuestas: un ítem de cumplimiento en `false` es exactamente el que deriva un
 * hallazgo.
 */
function hasAnswer(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * La respuesta de un ítem oculto no cuenta como respuesta, aunque venga en el
 * conjunto. Si contara, la visibilidad de un ítem dependería de decisiones que
 * el inspector ya deshizo, y dos dispositivos con el mismo documento podrían
 * mostrar formularios distintos.
 */
function evaluateCondition(condition: Condition, answer: unknown): boolean {
  switch (condition.operator) {
    case 'answered':
      return hasAnswer(answer);

    case 'unanswered':
      return !hasAnswer(answer);

    case 'equals':
      return hasAnswer(answer) && answer === condition.value;

    case 'not_equals':
      return hasAnswer(answer) && answer !== condition.value;

    case 'in':
      return hasAnswer(answer) && condition.value.some((candidate) => candidate === answer);

    case 'gte':
      return typeof answer === 'number' && answer >= condition.value;

    case 'lte':
      return typeof answer === 'number' && answer <= condition.value;
  }
}

function evaluateVisibleWhen(
  visibleWhen: VisibleWhen | undefined,
  answerOf: (itemKey: string) => unknown,
): boolean {
  if (!visibleWhen) return true;

  if ('all_of' in visibleWhen) {
    return visibleWhen.all_of.every((condition) =>
      evaluateCondition(condition, answerOf(condition.item_key)),
    );
  }

  if ('any_of' in visibleWhen) {
    return visibleWhen.any_of.some((condition) =>
      evaluateCondition(condition, answerOf(condition.item_key)),
    );
  }

  return evaluateCondition(visibleWhen, answerOf(visibleWhen.item_key));
}

/**
 * Devuelve, por `item_key`, si el ítem se muestra con estas respuestas.
 *
 * Una sola pasada hacia adelante: cuando se evalúa un ítem, todo lo que puede
 * referenciar ya está resuelto, porque el esquema rechaza en carga cualquier
 * `visible_when` que mire hacia adelante.
 *
 * Una sección oculta oculta todos sus ítems, sin importar el `visible_when` de
 * cada ítem.
 */
export function evaluateVisibility(document: TemplateDocument, answers: AnswerSet): VisibilityMap {
  const visibility: Record<string, boolean> = {};

  const answerOf = (itemKey: string): unknown =>
    visibility[itemKey] === false ? undefined : answers[itemKey];

  for (const [section, items] of sectionsInDocumentOrder(document)) {
    const sectionVisible = evaluateVisibleWhen(section.visible_when, answerOf);

    for (const item of items) {
      visibility[item.item_key] =
        sectionVisible && evaluateVisibleWhen(item.visible_when, answerOf);
    }
  }

  return visibility;
}

/** Si un ítem se muestra. Un ítem que el documento no contiene no se muestra. */
export function isVisible(visibility: VisibilityMap, itemKey: string): boolean {
  return visibility[itemKey] === true;
}
