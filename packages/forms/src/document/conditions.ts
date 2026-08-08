import { z } from 'zod';

import { ITEM_KEY_PATTERN } from './keys.js';

/**
 * La lógica condicional de un documento de plantilla.
 *
 * Deliberadamente chica: una condición mira **una** `item_key` con **un**
 * operador, y la composición llega hasta un nivel (`all_of` / `any_of`). No hay
 * anidamiento arbitrario ni una mini gramática de expresiones. Cada operador de
 * más es un operador que el cliente y el servidor pueden interpretar distinto, y
 * ninguna plantilla de inspección de v1 necesita más que esto.
 *
 * La restricción que hace fácil todo lo demás no está acá sino en el documento:
 * la `item_key` referenciada tiene que aparecer estrictamente antes en orden de
 * documento. Con eso la visibilidad se resuelve en una sola pasada y no hay
 * ciclos que detectar.
 */

/** Un valor comparable. Las respuestas de v1 son escalares o listas de escalares. */
const comparableValue = z.union([z.boolean(), z.string(), z.number()]);

const itemKeyRef = z
  .string()
  .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores');

const equalsCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('equals'),
  value: comparableValue,
});

const notEqualsCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('not_equals'),
  value: comparableValue,
});

const inCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('in'),
  value: z.array(comparableValue).min(1),
});

const gteCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('gte'),
  value: z.number(),
});

const lteCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('lte'),
  value: z.number(),
});

/** `answered` y `unanswered` no llevan `value`: preguntan por la presencia, no por el contenido. */
const answeredCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('answered'),
});

const unansweredCondition = z.strictObject({
  item_key: itemKeyRef,
  operator: z.literal('unanswered'),
});

export const CONDITION_OPERATORS = [
  'equals',
  'not_equals',
  'in',
  'gte',
  'lte',
  'answered',
  'unanswered',
] as const;

export type ConditionOperator = (typeof CONDITION_OPERATORS)[number];

export const conditionSchema = z.discriminatedUnion('operator', [
  equalsCondition,
  notEqualsCondition,
  inCondition,
  gteCondition,
  lteCondition,
  answeredCondition,
  unansweredCondition,
]);

export type Condition = z.infer<typeof conditionSchema>;

const allOfSchema = z.strictObject({ all_of: z.array(conditionSchema).min(1) });
const anyOfSchema = z.strictObject({ any_of: z.array(conditionSchema).min(1) });

/** Una condición suelta, o `all_of` / `any_of` de condiciones. Un solo nivel. */
export const visibleWhenSchema = z.union([conditionSchema, allOfSchema, anyOfSchema]);

export type VisibleWhen = z.infer<typeof visibleWhenSchema>;

/** Las `item_key` que una `visible_when` referencia, en orden de aparición. */
export function referencedItemKeys(visibleWhen: VisibleWhen): string[] {
  if ('all_of' in visibleWhen) {
    return visibleWhen.all_of.map((condition) => condition.item_key);
  }

  if ('any_of' in visibleWhen) {
    return visibleWhen.any_of.map((condition) => condition.item_key);
  }

  return [visibleWhen.item_key];
}
