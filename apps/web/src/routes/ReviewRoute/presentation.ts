import { FINDING_DESCRIPTION_MIN } from '@hs/contracts';
import { sectionsInDocumentOrder, type TemplateDocument, type Violation } from '@hs/forms';

import { IncompleteFindingsError, type IncompleteFinding } from '../../offline/drafts';

/**
 * QUÉ IMPIDE FIRMAR, DICHO COMO SE LO DIRÍA A UNA PERSONA.
 *
 * La pantalla mostraba lo que el motor devuelve, tal cual:
 *
 *     emergency.exits-unobstructed: missing description, missing location, missing photo
 *
 * Eso son tres cosas distintas mal dichas a la vez. `emergency.exits-unobstructed` es la
 * clave de máquina, no la pregunta que el inspector leyó en el recorrido —él vio
 * "Are emergency exits unobstructed?"—, así que la línea lo obliga a traducir una clave
 * para saber a qué ítem volver. "missing X, missing Y" repite la misma palabra tres
 * veces en vez de nombrar UNA acción. Y `required_missing` o `photo_count_out_of_range`,
 * del otro lado, son directamente vocabulario interno.
 *
 * Los códigos del motor son estables y de máquina A PROPÓSITO (`VIOLATION_CODES` lo dice
 * en `packages/forms`): el texto se arma donde se muestra. Este archivo es ese lugar.
 *
 * La regla al escribir cada texto: decir **qué hacer**, no qué falló. "Answer this
 * question" es accionable; "required_missing" es un diagnóstico dirigido a quien
 * escribió el motor.
 */

/** Una cosa que hay que arreglar, ya lista para pintar. */
export interface Blocker {
  readonly item_key: string;
  /** La pregunta tal como se lee en el recorrido. La `item_key` solo si no está. */
  readonly label: string;
  /** La sección donde vive, para ubicarla. `null` si el ítem no está en el documento. */
  readonly section: string | null;
  /** Qué hacer, una frase por cosa. */
  readonly reasons: readonly string[];
}

/**
 * TODO LO QUE BLOQUEA, EN UNA SOLA LISTA Y EN ORDEN DE RECORRIDO.
 *
 * Antes eran dos listas —respuestas por un lado, hallazgos por el otro— con dos avisos
 * y dos encabezados. Para el inspector no son dos problemas: son las paradas que le
 * quedan por hacer, y un ítem podía aparecer en las dos. Se unen por `item_key` y se
 * ordenan como el formulario, así la lista se recorre caminando en vez de saltando.
 *
 * Lo que el documento no conoce va al final: son las violaciones que hablan de la
 * plantilla (`unknown_item`) y no de una parada del recorrido.
 */
export function blockers(
  document: TemplateDocument,
  violations: readonly Violation[],
  incomplete: readonly IncompleteFinding[],
): Blocker[] {
  const reasons = new Map<string, string[]>();

  const add = (itemKey: string, reason: string): void => {
    const existing = reasons.get(itemKey);

    if (existing) existing.push(reason);
    else reasons.set(itemKey, [reason]);
  };

  for (const violation of violations) add(violation.item_key, violationReason(violation));
  for (const finding of incomplete) add(finding.item_key, findingReason(finding.missing));

  const blockers: Blocker[] = [];

  for (const [section, items] of sectionsInDocumentOrder(document)) {
    for (const item of items) {
      const itemReasons = reasons.get(item.item_key);
      if (!itemReasons) continue;

      reasons.delete(item.item_key);
      blockers.push({
        item_key: item.item_key,
        label: item.prompt,
        section: section.section_title,
        reasons: itemReasons,
      });
    }
  }

  for (const [item_key, itemReasons] of reasons) {
    blockers.push({ item_key, label: item_key, section: null, reasons: itemReasons });
  }

  return blockers;
}

/**
 * El texto de una violación del motor.
 *
 * `detail` viaja como `Record<string, unknown>` porque el motor no sabe quién lo va a
 * leer. Se extrae con `numberDetail`, que devuelve `null` ante cualquier cosa que no sea
 * un número: un texto sin el límite adentro es peor que ideal, pero un texto que dice
 * "between undefined and undefined" es una pantalla rota.
 */
export function violationReason(violation: Violation): string {
  const detail = violation.detail ?? {};

  switch (violation.code) {
    case 'required_missing':
      return 'Answer this question.';

    case 'out_of_range': {
      const range = between(numberDetail(detail, 'min'), numberDetail(detail, 'max'));

      return range ? `Enter a value ${range}.` : 'The value entered is out of range.';
    }

    case 'too_many_decimals': {
      const decimals = numberDetail(detail, 'decimals');

      if (decimals === null) return 'Round the value: it has too many decimals.';

      return decimals === 0
        ? 'Enter a whole number.'
        : `Round the value to ${decimals} decimal${decimals === 1 ? '' : 's'}.`;
    }

    case 'too_long': {
      const max = numberDetail(detail, 'max_length');

      return max === null
        ? 'Shorten the answer: it is too long.'
        : `Shorten the answer to ${max} characters or fewer.`;
    }

    case 'selection_count_out_of_range': {
      const min = numberDetail(detail, 'min_selected');
      const max = numberDetail(detail, 'max_selected');
      const range = between(min, max);

      return range
        ? `Select ${range} ${noun('option', max ?? min)}.`
        : 'Change how many options are selected.';
    }

    case 'photo_count_out_of_range': {
      const min = numberDetail(detail, 'min_count');
      const max = numberDetail(detail, 'max_count');
      const range = between(min, max);

      return range
        ? `Attach ${range} ${noun('photo', max ?? min)}.`
        : 'Change how many photos are attached.';
    }

    case 'duplicate_option':
      return 'The same option is selected twice.';

    case 'unknown_option':
      return 'The option chosen is no longer offered for this question. Answer it again.';

    /**
     * Los tres que NO son culpa del inspector, y por eso no le piden nada.
     *
     * Una respuesta con la forma equivocada, una que no pertenece a la plantilla, o una
     * que quedó de un ítem que ahora está oculto, son fallas del dispositivo o de una
     * plantilla que cambió. Decirle "arreglalo" a quien no puede arreglarlo lo manda a
     * buscar un campo que no existe: el texto nombra el problema y a quién avisarle.
     */
    case 'wrong_shape':
    case 'unknown_item':
      return 'This answer was not saved correctly on this device. Report it before signing.';

    case 'answer_for_hidden_item':
      return 'This question no longer applies, but an answer is still stored. Open it in the walkthrough to clear it.';
  }
}

/**
 * Lo que le falta a un hallazgo, en UNA frase.
 *
 * "missing description, missing location, missing photo" son tres etiquetas; esto es una
 * instrucción: "Add a description, a location and a photo". La distinción entre vacío y
 * demasiado corto se conserva —el inspector que escribió "ok" tiene que saber que lo que
 * hay no alcanza, no que no hay nada— y por eso ese caso trae su propio texto con el
 * mínimo adentro.
 */
export function findingReason(missing: IncompleteFinding['missing']): string {
  return `This item failed, so it needs a finding. Add ${andList(missing.map(missingPhrase))}.`;
}

function missingPhrase(missing: IncompleteFinding['missing'][number]): string {
  switch (missing) {
    case 'description':
      return 'a description';
    case 'description_too_short':
      return `a longer description (at least ${FINDING_DESCRIPTION_MIN} characters)`;
    case 'location':
      return 'a location';
    case 'photo':
      return 'a photo';
  }
}

/**
 * POR QUÉ NO SE FIRMÓ, para quien está parado en la planta.
 *
 * El mensaje del error no se muestra nunca: `IncompleteFindingsError` trae una cadena en
 * español con `item_key`s adentro —está escrita para quien lee el código, no para el
 * inspector— y cualquier otro error acá es una falla de Dexie con su propio vocabulario.
 * Lo único que el inspector necesita saber es qué pasó con su trabajo y qué hacer ahora.
 *
 * Los dos textos empiezan por lo mismo, y es deliberado: **no se firmó y no se envió
 * nada**. Firmar es el punto de no retorno (ADR-001), así que la primera pregunta ante
 * un error es siempre si el punto ya se cruzó.
 */
export function signFailure(error: unknown): string {
  if (error instanceof IncompleteFindingsError) {
    return 'A finding on this inspection is no longer complete. Go back to the walkthrough and add the missing details.';
  }

  return 'Nothing was saved and nothing was sent. Try again, and if it keeps failing report it before you leave the site.';
}

/** "a, b and c". Sin coma de Oxford: la UI es inglés y no hay i18n (contexto). */
export function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';

  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * "between 1 and 3", o "at least 2" / "at most 5" cuando solo hay un extremo, o cuando
 * los dos son el mismo número —"between 1 and 1" es una forma rara de decir "1"—.
 */
function between(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return min === max ? `${min}` : `between ${min} and ${max}`;
  if (min !== null) return `at least ${min}`;
  if (max !== null) return `at most ${max}`;

  return null;
}

/**
 * El sustantivo del límite. Singular solo cuando el tope es exactamente uno: "at least 1
 * photo" y "between 1 and 3 photos" concuerdan con el número que el inspector lee al
 * lado, que es el único que le importa.
 */
function noun(word: string, bound: number | null): string {
  return bound === 1 ? word : `${word}s`;
}

function numberDetail(detail: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = detail[key];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * EL VEREDICTO DE LA PANTALLA, en una línea y su explicación.
 *
 * Es lo primero que se lee al llegar, y por eso responde la única pregunta con la que el
 * inspector abre esta pantalla: ¿puedo firmar o no? Antes eso había que deducirlo —una
 * frase suelta cuando estaba todo, un aviso ámbar cuando no— y las dos vivían en el mismo
 * lugar de la página sin decir cuál era el estado.
 *
 * El texto de abajo NO repite el de arriba: el título dice en qué estado está, el texto
 * dice qué hacer con eso. Repetirlo sería gastar el renglón que nombra la salida.
 */
export function verdict(stops: number): { readonly title: string; readonly text: string } {
  if (stops === 0) {
    return {
      title: 'Ready to sign',
      text: 'Everything required has been answered. Signing sends this inspection.',
    };
  }

  return {
    title: `${stops} item${stops === 1 ? '' : 's'} still need${stops === 1 ? 's' : ''} your attention`,
    text: 'Fix each one in the walkthrough. Signing opens as soon as the list is empty.',
  };
}

/** La píldora que cuenta las paradas. Cuenta cosas, no dice qué hacer: ese es el veredicto. */
export function stopsLabel(stops: number): string {
  return `${stops} to fix`;
}

/**
 * Las fotos que todavía no salieron del dispositivo.
 *
 * No bloquea firmar y el texto lo dice antes que nada: una foto pendiente es trabajo del
 * outbox, no una parada del recorrido. Sin esa aclaración el número se lee como un
 * impedimento más y el inspector se queda esperando una barra de progreso que no le toca
 * mirar.
 */
export function pendingPhotosNote(pending: number): string {
  return `${pending} photo${pending === 1 ? '' : 's'} still to upload. They go out before the submission itself — you can sign now and they will be sent together when there is a connection.`;
}

/**
 * Cuánto se contestó, dicho como cobertura y no como progreso.
 *
 * "12 of 12 answered" y no un porcentaje: el porcentaje es la lectura de quien todavía
 * está trabajando —y esa vive en la pantalla de la asignación—, mientras que acá lo que se
 * revisa es qué se va a firmar. El denominador son los ítems VISIBLES, que es el que
 * cuenta `@hs/forms`: un ítem que otra respuesta ocultó no está sin contestar, no existe.
 */
export function coverageLabel(answered: number, total: number): string {
  return `${answered} of ${total} answered`;
}
