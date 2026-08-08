import { YES_NO_NA_VALUES, type AnswerSet } from './answers.js';
import {
  itemsInDocumentOrder,
  type TemplateDocument,
  type TemplateItem,
  type TemplateItemOf,
} from './schema.js';
import { evaluateVisibility } from './visibility.js';

/**
 * Validación de un conjunto de respuestas contra una versión de plantilla.
 *
 * Es la función que corre dos veces: en el dispositivo antes de dejar enviar, y
 * en el servidor al recibir el envío. Que sea el mismo código es el punto entero
 * de ADR-007 — si divergieran, el inspector recorre 48 acres, firma, sincroniza
 * y el servidor rechaza.
 *
 * Pura: sin red, sin base, sin reloj y sin azar. Lo que depende del estado de la
 * base (que la `item_key` esté registrada, que la versión sea la vigente) lo
 * verifica el servidor con claves foráneas, no esto.
 */

/**
 * Los códigos son estables y de máquina: el cliente los mapea a una marca por
 * ítem y el servidor a su respuesta de error. El texto se arma donde se muestra.
 */
export const VIOLATION_CODES = [
  /** Un ítem visible y `required` sin respuesta. */
  'required_missing',
  /** La respuesta no tiene la forma que el `response_type` pide. */
  'wrong_shape',
  /** `scale` o `number` fuera del rango declarado. */
  'out_of_range',
  /** `number` con más decimales que los declarados. */
  'too_many_decimals',
  /** `text` más largo que `max_length`. */
  'too_long',
  /** Un valor seleccionado que no está entre las `options` del ítem. */
  'unknown_option',
  /** El mismo valor seleccionado dos veces en un `multi_choice`. */
  'duplicate_option',
  /** Menos de `min_selected` o más de `max_selected`. */
  'selection_count_out_of_range',
  /** Menos de `min_count` o más de `max_count` object keys de foto. */
  'photo_count_out_of_range',
  /** Una respuesta para una `item_key` que el documento no contiene. */
  'unknown_item',
  /** Una respuesta para un ítem que estas mismas respuestas dejan oculto. */
  'answer_for_hidden_item',
] as const;

export type ViolationCode = (typeof VIOLATION_CODES)[number];

export interface Violation {
  readonly item_key: string;
  readonly code: ViolationCode;
  /** Datos del caso, para armar el texto donde se muestre. */
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly violations: readonly Violation[] };

function isMissing(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

/** Cuántos decimales tiene un número, sin pasar por su representación exponencial. */
function decimalPlaces(value: number): number {
  if (Number.isInteger(value)) return 0;

  const text = String(value);
  const dot = text.indexOf('.');

  return dot === -1 ? 0 : text.length - dot - 1;
}

/** Todos los valores de un array de strings, o `null` si no es eso. */
function asStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  if (value.some((entry) => typeof entry !== 'string' || entry.trim().length === 0)) return null;

  return value as string[];
}

function checkChoiceValues(
  item: TemplateItemOf<'single_choice'> | TemplateItemOf<'multi_choice'>,
  selected: readonly string[],
  push: (code: ViolationCode, detail?: Record<string, unknown>) => void,
): void {
  const known = new Set(item.options.map((option) => option.value));
  const seen = new Set<string>();

  for (const value of selected) {
    if (!known.has(value)) {
      push('unknown_option', { value });
    }

    if (seen.has(value)) {
      push('duplicate_option', { value });
    }

    seen.add(value);
  }
}

/**
 * Verifica una respuesta contra la configuración de su ítem. El ítem ya se sabe
 * visible y la respuesta ya se sabe presente.
 */
function checkAnswer(
  item: TemplateItem,
  answer: unknown,
  push: (code: ViolationCode, detail?: Record<string, unknown>) => void,
): void {
  switch (item.response_type) {
    case 'yes_no':
      if (typeof answer !== 'boolean') push('wrong_shape', { expected: 'boolean' });

      break;

    case 'yes_no_na':
      if (typeof answer !== 'string' || !YES_NO_NA_VALUES.some((value) => value === answer)) {
        push('wrong_shape', { expected: YES_NO_NA_VALUES });
      }

      break;

    case 'scale':
      if (typeof answer !== 'number' || !Number.isInteger(answer)) {
        push('wrong_shape', { expected: 'integer' });
        break;
      }

      if (answer < item.min || answer > item.max) {
        push('out_of_range', { min: item.min, max: item.max });
      }

      break;

    case 'number':
      if (typeof answer !== 'number' || !Number.isFinite(answer)) {
        push('wrong_shape', { expected: 'number' });
        break;
      }

      if (answer < item.min || answer > item.max) {
        push('out_of_range', { min: item.min, max: item.max });
      }

      if (decimalPlaces(answer) > item.decimals) {
        push('too_many_decimals', { decimals: item.decimals });
      }

      break;

    case 'text':
      if (typeof answer !== 'string') {
        push('wrong_shape', { expected: 'string' });
        break;
      }

      if (answer.length > item.max_length) {
        push('too_long', { max_length: item.max_length });
      }

      break;

    case 'single_choice':
      if (typeof answer !== 'string') {
        push('wrong_shape', { expected: 'string' });
        break;
      }

      checkChoiceValues(item, [answer], push);

      break;

    case 'multi_choice': {
      const selected = asStringArray(answer);

      if (selected === null) {
        push('wrong_shape', { expected: 'string[]' });
        break;
      }

      checkChoiceValues(item, selected, push);

      if (selected.length < item.min_selected || selected.length > item.max_selected) {
        push('selection_count_out_of_range', {
          min_selected: item.min_selected,
          max_selected: item.max_selected,
        });
      }

      break;
    }

    case 'photo': {
      // Object keys, no blobs: las fotos se suben antes del envío (ADR-001).
      const keys = asStringArray(answer);

      if (keys === null) {
        push('wrong_shape', { expected: 'object_key[]' });
        break;
      }

      if (keys.length < item.min_count || keys.length > item.max_count) {
        push('photo_count_out_of_range', { min_count: item.min_count, max_count: item.max_count });
      }

      break;
    }

    case 'signature': {
      const signature = answer as { object_key?: unknown; signed_at?: unknown } | null;

      if (
        typeof signature !== 'object' ||
        signature === null ||
        Array.isArray(signature) ||
        typeof signature.object_key !== 'string' ||
        signature.object_key.trim().length === 0 ||
        typeof signature.signed_at !== 'string' ||
        signature.signed_at.trim().length === 0
      ) {
        push('wrong_shape', { expected: '{ object_key, signed_at }' });
      }

      break;
    }
  }
}

/**
 * Valida un conjunto de respuestas contra un documento y devuelve **todas** las
 * violaciones, no la primera: el inspector tiene que ver de una vez todo lo que
 * le falta, no descubrirlo de a un envío rechazado por vez.
 */
export function validateAnswers(document: TemplateDocument, answers: AnswerSet): ValidationResult {
  const violations: Violation[] = [];
  const visibility = evaluateVisibility(document, answers);
  const items = itemsInDocumentOrder(document);

  for (const item of items) {
    const push = (code: ViolationCode, detail?: Record<string, unknown>): void => {
      violations.push(
        detail ? { item_key: item.item_key, code, detail } : { item_key: item.item_key, code },
      );
    };

    const answer = answers[item.item_key];
    const answered = !isMissing(answer);

    if (!visibility[item.item_key]) {
      // Un ítem oculto no se exige y tampoco puede traer respuesta: aceptarla en
      // silencio dejaría en el registro inmutable una respuesta a una pregunta
      // que el inspector nunca vio.
      if (answered) push('answer_for_hidden_item');

      continue;
    }

    if (!answered) {
      if (item.required) push('required_missing');

      continue;
    }

    checkAnswer(item, answer, push);
  }

  const known = new Set(items.map((item) => item.item_key));

  for (const item_key of Object.keys(answers)) {
    if (!known.has(item_key)) {
      violations.push({ item_key, code: 'unknown_item' });
    }
  }

  return violations.length === 0 ? { ok: true } : { ok: false, violations };
}
