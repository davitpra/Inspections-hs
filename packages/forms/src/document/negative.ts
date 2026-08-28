import type { AnswerSet } from './answers.js';
import {
  itemsInDocumentOrder,
  type TemplateDocument,
  type TemplateItem,
  type YesNoNaFailsOn,
} from './schema.js';
import { evaluateVisibility, isVisible } from './visibility.js';

/**
 * Requisitos §3 R2 — qué respuesta genera un hallazgo.
 *
 * Es la tercera función que corre dos veces: en el dispositivo, para pedirle al
 * inspector la descripción, la ubicación y la foto en el momento en que responde
 * mal; y en el servidor, para exigir que el envío las traiga (ADR-007). Si
 * divergieran, el dispositivo pediría detalles de tres ítems y el servidor
 * esperaría cuatro: el inspector recorre 48 acres, firma, sincroniza y el envío
 * se rechaza por un dato que nadie le pidió.
 *
 * Pura, como `validateAnswers` y `evaluateVisibility`, y por el mismo motivo.
 */

/**
 * Qué respuestas de `yes_no_na` cuentan como incumplimiento, por modo de fallo.
 *
 * A diferencia de `yes_no`, acá `na` sí puede ser (parte de) la falla: un modo
 * como `no_na` existe para el ítem donde "no aplica" declarado a la ligera
 * amerita la misma revisión que un "No" — el `finding` para ese caso no es
 * automático, pero se acepta la respuesta.
 */
const YES_NO_NA_FAILING_ANSWERS: Record<YesNoNaFailsOn, readonly string[]> = {
  no: ['no'],
  yes: ['yes'],
  na: ['na'],
  no_na: ['no', 'na'],
  yes_na: ['yes', 'na'],
};

/**
 * `yes_no` y `yes_no_na` son configurables por ítem (`fails_on`, por defecto
 * `'no'`): el autor elige qué respuesta o respuestas cuentan como
 * incumplimiento, y esta función lee esa elección en vez de asumirla.
 *
 * Ningún otro `response_type` deriva hallazgo. `scale` y `number` no tienen
 * umbral en el documento —el `weight` del riesgo E está oculto a propósito y no
 * significa esto—, así que cualquier corte sería inventado; las selecciones y
 * los textos no tienen semántica de cumplimiento. El día que un ítem la
 * necesite, la decisión es del builder y se toma explícitamente.
 */
function isNegative(item: TemplateItem, answer: unknown): boolean {
  if (item.response_type === 'yes_no') return answer === (item.fails_on === 'yes');

  if (item.response_type === 'yes_no_na') {
    return typeof answer === 'string' && YES_NO_NA_FAILING_ANSWERS[item.fails_on].includes(answer);
  }

  return false;
}

/**
 * Las `item_key` de las respuestas negativas, en orden de documento.
 *
 * Un ítem oculto no deriva nada aunque traiga respuesta: no forma parte del
 * conjunto de respuestas: `validateAnswers` ya lo rechaza como
 * `answer_for_hidden_item`, y pedir un hallazgo por una pregunta que el
 * inspector no vio no tendría sentido. Un ítem que el documento no contiene
 * tampoco: eso es `unknown_item`, y también lo rechaza la validación.
 */
export function negativeAnswers(document: TemplateDocument, answers: AnswerSet): string[] {
  const visibility = evaluateVisibility(document, answers);

  return itemsInDocumentOrder(document)
    .filter(
      (item) =>
        isVisible(visibility, item.item_key) &&
        isNegative(item, answers[item.item_key]),
    )
    .map((item) => item.item_key);
}
