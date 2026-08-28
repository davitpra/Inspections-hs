import { z } from 'zod';

import { referencedItemKeys, visibleWhenSchema } from './conditions.js';
import { findingSchema, type FindingPrescription } from './finding.js';
import { ITEM_KEY_PATTERN, SECTION_KEY_PATTERN } from './keys.js';
import {
  templateDocumentSchema,
  yesNoNaFailsOnSchema,
  type ResponseType,
  type TemplateDocument,
} from './schema.js';

/**
 * El documento de una plantilla **mientras se escribe**.
 *
 * `schema.ts` describe el documento congelado y es estricto con razón: una
 * sección sin ítems o un `prompt` vacío no se pueden publicar. Pero es el estado
 * en el que un documento pasa la mayor parte de su vida mientras alguien lo
 * escribe, y un guardado que lo rechazara obligaría a terminar una sección antes
 * de poder dejarla a medias. Este archivo es la versión laxa del mismo
 * documento, más la función que dice qué le falta para poder publicarse.
 *
 * TRES DIFERENCIAS CON EL DOCUMENTO PUBLICADO, y ninguna más:
 *
 *  1. **No hay `position`.** El orden lo lleva el arreglo y `normalizeDraft` lo
 *     deriva del índice. Con eso "dos ítems comparten la position" —que en
 *     `schema.ts` es un refinement con su mensaje de error— deja de ser un
 *     estado alcanzable, en vez de ser un error que el autor tiene que entender.
 *  2. **Lo incompleto se acepta**: secciones sin ítems, textos vacíos, claves a
 *     medio escribir, configuraciones que se contradicen.
 *  3. **Lo imposible sigue sin aceptarse.** `response_type` sigue siendo un enum
 *     cerrado y la configuración sigue siendo una unión discriminada de
 *     `strictObject`: un tipo inventado o un campo que le sobra no es una idea a
 *     medio terminar, es un bug del cliente. Que rompa en el guardado y no en la
 *     publicación, meses después.
 *
 * Vive acá y no en `apps/web` por ADR-007: la publicación va a re-hacer esta
 * misma comprobación en el servidor, y dos implementaciones de "¿esto se puede
 * publicar?" terminan discrepando, con la pantalla diciendo que sí y el servidor
 * diciendo que no.
 */

/** Una opción de un ítem de selección recién agregada está vacía; se acepta y se reporta. */
const draftChoiceOptionSchema = z.strictObject({
  value: z.string(),
  label: z.string(),
});

/**
 * Los campos numéricos van sin `.int()` ni `.min()` a propósito: un `max_length`
 * en cero o una escala al revés son cosas que alguien está por terminar de
 * escribir, y `draftIssues` las nombra. Lo que no se acepta es que no sean
 * números.
 */
const draftItemBase = {
  item_key: z.string(),
  prompt: z.string(),
  required: z.boolean(),
  visible_when: visibleWhenSchema.optional(),
  // Un bloque mantiene junta la acción y su umbral; así no existen prescripciones a medias.
  finding: findingSchema.optional(),
};

const draftItemSchema = z.discriminatedUnion('response_type', [
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('yes_no'),
    fails_on: z.enum(['yes', 'no']).default('no'),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('yes_no_na'),
    fails_on: yesNoNaFailsOnSchema.default('no'),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('scale'),
    min: z.number(),
    max: z.number(),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('text'),
    max_length: z.number(),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('number'),
    min: z.number(),
    max: z.number(),
    decimals: z.number(),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('single_choice'),
    options: z.array(draftChoiceOptionSchema),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('multi_choice'),
    options: z.array(draftChoiceOptionSchema),
    min_selected: z.number(),
    max_selected: z.number(),
  }),
  z.strictObject({
    ...draftItemBase,
    response_type: z.literal('photo'),
    min_count: z.number(),
    max_count: z.number(),
  }),
  z.strictObject({ ...draftItemBase, response_type: z.literal('signature') }),
]);

export const templateDraftItemSchema = draftItemSchema;

export type TemplateDraftItem = z.infer<typeof templateDraftItemSchema>;

/** El ítem en borrador de un `response_type` concreto: `TemplateDraftItemOf<'scale'>`. */
export type TemplateDraftItemOf<T extends ResponseType> = Extract<
  TemplateDraftItem,
  { response_type: T }
>;

export const templateDraftSectionSchema = z.strictObject({
  section_key: z.string(),
  section_title: z.string(),
  organization_location_code: z.string().optional(),
  visible_when: visibleWhenSchema.optional(),
  items: z.array(templateDraftItemSchema),
});

export type TemplateDraftSection = z.infer<typeof templateDraftSectionSchema>;

export const templateDraftDocumentSchema = z.strictObject({
  sections: z.array(templateDraftSectionSchema),
});

export type TemplateDraftDocument = z.infer<typeof templateDraftDocumentSchema>;

/** Un borrador recién creado: sin secciones, guardable, no publicable. */
export function emptyDraftDocument(): TemplateDraftDocument {
  return { sections: [] };
}

/**
 * El borrador con las `position` puestas: secciones en orden de arreglo desde 1,
 * y dentro de cada una sus ítems en orden de arreglo desde 1.
 *
 * El tipo de retorno es `TemplateDocument` porque es la forma que se pretende,
 * no la que se garantiza: un borrador incompleto normaliza a un documento que
 * `templateDocumentSchema` va a rechazar. Quien quiera la garantía parsea.
 */
export function normalizeDraft(draft: TemplateDraftDocument): TemplateDocument {
  return {
    sections: draft.sections.map((section, sectionIndex) => ({
      ...section,
      position: sectionIndex + 1,
      items: section.items.map((item, itemIndex) => ({
        ...item,
        position: itemIndex + 1,
      })),
    })),
  } as TemplateDocument;
}

/**
 * La inversa de `normalizeDraft`: el documento congelado, de vuelta en forma de
 * borrador.
 *
 * Saca `position` de cada sección y de cada ítem, y no toca NADA más. El orden no
 * se pierde: pasa de estar en un campo a estar en el arreglo, que es donde el
 * borrador lo lleva (diferencia 1 de la cabecera de este archivo).
 *
 * Existe para revisar una plantilla publicada: la versión N+1 se escribe editando
 * la N, y cada `item_key` tiene que llegar intacto porque es lo que mantiene una
 * sola serie de recurrencia a través de las versiones.
 *
 * `draftFromDocument(normalizeDraft(d))` devuelve `d`. La otra vuelta no es una
 * identidad y no puede serlo: `normalizeDraft` inventa las `position` a partir del
 * orden, así que un documento con posiciones que no son 1..n vuelve con otras.
 */
export function draftFromDocument(document: TemplateDocument): TemplateDraftDocument {
  return {
    sections: document.sections.map(({ position: _sectionPosition, items, ...section }) => ({
      ...section,
      items: items.map(({ position: _itemPosition, ...item }) => item),
    })),
  } as TemplateDraftDocument;
}

/**
 * Lo que le falta a un borrador para poder publicarse.
 *
 * `path` ubica el problema dentro del borrador —`['sections', 2, 'items', 0]`—
 * para que la pantalla pueda llevar al autor hasta ahí. `message` está en inglés
 * y nombra la sección o el ítem, porque una lista de problemas que dice "invalid
 * input" tres veces no es una lista de problemas.
 */
export interface DraftIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Los mensajes se escriben acá, en inglés, y NO se toman de los `issue.message`
 * de Zod: los de `schema.ts` están en español, que es correcto para el código y
 * no para la pantalla (`openspec/config.yaml`, UI solo en inglés).
 *
 * Que las dos listas no se separen no se deja librado a la disciplina: si las
 * comprobaciones de acá no cubren algo que `templateDocumentSchema` sí rechaza,
 * el parse estricto del final devuelve el aviso genérico y `draft.test.ts` falla,
 * porque afirma que ningún caso de su tabla llega hasta ese último renglón. La
 * equivalencia entre "sin issues" y "parsea" queda garantizada por construcción.
 */
export function draftIssues(draft: TemplateDraftDocument): DraftIssue[] {
  const issues: DraftIssue[] = [];

  if (draft.sections.length === 0) {
    issues.push({ path: ['sections'], message: 'The template has no sections.' });
  }

  const sectionKeys = new Map<string, number>();
  const itemKeys = new Map<string, number>();

  draft.sections.forEach((section, sectionIndex) => {
    const where = sectionLabel(section, sectionIndex);
    const path = ['sections', sectionIndex];

    if (section.section_title.trim().length === 0) {
      issues.push({ path, message: `${where} has no title.` });
    }

    if (section.organization_location_code !== undefined && section.organization_location_code.trim().length === 0) {
      issues.push({ path, message: `${where} does not name an organization location.` });
    }

    if (!SECTION_KEY_PATTERN.test(section.section_key)) {
      issues.push({
        path,
        message: `${where} has an invalid key: use lower-case letters, digits, and "." or "-" as separators.`,
      });
    } else if (sectionKeys.has(section.section_key)) {
      issues.push({
        path,
        message: `${where} repeats the key "${section.section_key}", which is already used by another section.`,
      });
    } else {
      sectionKeys.set(section.section_key, sectionIndex);
    }

    if (section.items.length === 0) {
      issues.push({ path, message: `${where} has no items.` });
    }

    section.items.forEach((item, itemIndex) => {
      const itemWhere = itemLabel(item, itemIndex, where);
      const itemPath = ['sections', sectionIndex, 'items', itemIndex];

      if (item.prompt.trim().length === 0) {
        issues.push({ path: itemPath, message: `${itemWhere} has no question text.` });
      }

      if (!ITEM_KEY_PATTERN.test(item.item_key)) {
        issues.push({
          path: itemPath,
          message: `${itemWhere} has an invalid key: use lower-case letters, digits, and "." or "-" as separators.`,
        });
      } else if (itemKeys.has(item.item_key)) {
        issues.push({
          path: itemPath,
          message: `${itemWhere} repeats the key "${item.item_key}", which is already used by another item.`,
        });
      } else {
        itemKeys.set(item.item_key, itemIndex);
      }

      checkItemConfig(item, itemWhere, itemPath, issues);
    });
  });

  checkVisibility(draft, issues);

  if (issues.length > 0) return issues;

  // La red de seguridad. Inalcanzable mientras las comprobaciones de arriba
  // cubran todo lo que el esquema estricto rechaza, y `draft.test.ts` lo afirma.
  if (!templateDocumentSchema.safeParse(normalizeDraft(draft)).success) {
    return [{ path: [], message: 'This template cannot be published yet.' }];
  }

  return [];
}

function sectionLabel(section: TemplateDraftSection, index: number): string {
  const title = section.section_title.trim();
  return title.length > 0 ? `Section "${title}"` : `Section ${index + 1}`;
}

function itemLabel(item: TemplateDraftItem, index: number, sectionWhere: string): string {
  const prompt = item.prompt.trim();
  const lowered = sectionWhere.charAt(0).toLowerCase() + sectionWhere.slice(1);

  return prompt.length > 0
    ? `Item "${truncate(prompt)}" in ${lowered}`
    : `Item ${index + 1} in ${lowered}`;
}

function truncate(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

function isWholeNumber(value: number): boolean {
  return Number.isInteger(value);
}

/**
 * La coherencia de la configuración de un ítem, tipo por tipo. Es la misma tabla
 * de reglas que `checkItemConfig` en `schema.ts` más las que allá las impone el
 * propio esquema (`.int()`, `.positive()`, `.min(1)`), porque acá el esquema no
 * las impone: un borrador las puede tener mal y guardarse igual.
 */
function checkItemConfig(
  item: TemplateDraftItem,
  where: string,
  path: (string | number)[],
  issues: DraftIssue[],
): void {
  checkFinding(item.finding, item, where, path, issues);

  switch (item.response_type) {
    case 'scale':
      if (!isWholeNumber(item.min) || !isWholeNumber(item.max)) {
        issues.push({ path, message: `${where}: the scale bounds must be whole numbers.` });
      } else if (item.min >= item.max) {
        issues.push({
          path,
          message: `${where}: the scale minimum (${item.min}) must be lower than its maximum (${item.max}).`,
        });
      }

      break;

    case 'text':
      if (!isWholeNumber(item.max_length) || item.max_length < 1) {
        issues.push({
          path,
          message: `${where}: the maximum length must be a whole number of at least 1.`,
        });
      }

      break;

    case 'number':
      if (!isWholeNumber(item.decimals) || item.decimals < 0) {
        issues.push({
          path,
          message: `${where}: the number of decimals must be a whole number of 0 or more.`,
        });
      }

      if (item.min > item.max) {
        issues.push({
          path,
          message: `${where}: the minimum (${item.min}) cannot be greater than the maximum (${item.max}).`,
        });
      }

      break;

    case 'single_choice':
    case 'multi_choice': {
      checkOptions(item.options, where, path, issues);

      if (item.response_type === 'multi_choice') {
        if (!isWholeNumber(item.min_selected) || item.min_selected < 0) {
          issues.push({
            path,
            message: `${where}: the minimum number of selections must be a whole number of 0 or more.`,
          });
        }

        if (!isWholeNumber(item.max_selected) || item.max_selected < 1) {
          issues.push({
            path,
            message: `${where}: the maximum number of selections must be a whole number of at least 1.`,
          });
        }

        if (item.min_selected > item.max_selected) {
          issues.push({
            path,
            message: `${where}: the minimum number of selections (${item.min_selected}) cannot be greater than the maximum (${item.max_selected}).`,
          });
        }

        if (Math.max(item.min_selected, item.max_selected) > item.options.length) {
          issues.push({
            path,
            message: `${where}: the selection limits ask for more than the ${item.options.length} option(s) offered.`,
          });
        }
      }

      break;
    }

    case 'photo':
      if (!isWholeNumber(item.min_count) || item.min_count < 0) {
        issues.push({
          path,
          message: `${where}: the minimum number of photos must be a whole number of 0 or more.`,
        });
      }

      if (!isWholeNumber(item.max_count) || item.max_count < 1) {
        issues.push({
          path,
          message: `${where}: the maximum number of photos must be a whole number of at least 1.`,
        });
      }

      if (item.min_count > item.max_count) {
        issues.push({
          path,
          message: `${where}: the minimum number of photos (${item.min_count}) cannot be greater than the maximum (${item.max_count}).`,
        });
      }

      break;

    default:
      break;
  }
}

function checkFinding(
  finding: FindingPrescription | undefined,
  item: TemplateDraftItem,
  where: string,
  path: (string | number)[],
  issues: DraftIssue[],
): void {
  if (!finding) return;

  if (finding.corrective_action.trim().length === 0) {
    issues.push({ path, message: `${where}: the corrective action cannot be blank.` });
  }

  if (!finding.fails_when) return;

  if (item.response_type !== 'scale' && item.response_type !== 'number') {
    issues.push({
      path,
      message: `${where}: a failure threshold only applies to scale and number questions.`,
    });
    return;
  }

  if (finding.fails_when.value < item.min || finding.fails_when.value > item.max) {
    issues.push({
      path,
      message: `${where}: the failure threshold (${finding.fails_when.value}) must be between ${item.min} and ${item.max}.`,
    });
  }
}

function checkOptions(
  options: readonly { value: string; label: string }[],
  where: string,
  path: (string | number)[],
  issues: DraftIssue[],
): void {
  if (options.length === 0) {
    issues.push({ path, message: `${where} offers no options to choose from.` });
    return;
  }

  if (options.some((option) => option.value.trim().length === 0)) {
    issues.push({ path, message: `${where} has an option with no stored value.` });
  }

  if (options.some((option) => option.label.trim().length === 0)) {
    issues.push({ path, message: `${where} has an option with no label.` });
  }

  const seen = new Set<string>();

  for (const option of options) {
    if (seen.has(option.value) && option.value.trim().length > 0) {
      issues.push({
        path,
        message: `${where} repeats the option value "${option.value}".`,
      });

      break;
    }

    seen.add(option.value);
  }
}

/**
 * Una `visible_when` solo puede mirar hacia atrás: la `item_key` referenciada
 * tiene que existir en el documento y aparecer estrictamente antes en orden de
 * documento (`schema.ts`). Es la regla que hace que reordenar pueda romper un
 * documento que estaba bien, así que se reporta acá y no se descubre al publicar.
 */
function checkVisibility(draft: TemplateDraftDocument, issues: DraftIssue[]): void {
  const order = new Map<string, number>();
  const sectionStart = new Map<number, number>();

  let index = 0;

  draft.sections.forEach((section, sectionIndex) => {
    sectionStart.set(sectionIndex, index);

    for (const item of section.items) {
      if (!order.has(item.item_key)) order.set(item.item_key, index);
      index += 1;
    }
  });

  draft.sections.forEach((section, sectionIndex) => {
    const where = sectionLabel(section, sectionIndex);

    check(
      section.visible_when,
      sectionStart.get(sectionIndex) ?? 0,
      ['sections', sectionIndex],
      where,
    );

    let itemPosition = sectionStart.get(sectionIndex) ?? 0;

    section.items.forEach((item, itemIndex) => {
      check(
        item.visible_when,
        itemPosition,
        ['sections', sectionIndex, 'items', itemIndex],
        itemLabel(item, itemIndex, where),
      );

      itemPosition += 1;
    });
  });

  function check(
    visibleWhen: TemplateDraftSection['visible_when'],
    boundary: number,
    path: (string | number)[],
    where: string,
  ): void {
    if (!visibleWhen) return;

    for (const key of referencedItemKeys(visibleWhen)) {
      const referenced = order.get(key);

      if (referenced === undefined) {
        issues.push({
          path,
          message: `${where} is shown depending on "${key}", which no item in this template answers.`,
        });

        continue;
      }

      if (referenced >= boundary) {
        issues.push({
          path,
          message: `${where} is shown depending on "${key}", which comes later in the template.`,
        });
      }
    }
  }
}

/**
 * La configuración con la que nace un ítem de cada tipo.
 *
 * Cambiar el `response_type` de un ítem **reemplaza** su configuración, no la
 * mezcla: un `max_length` sobreviviendo en un ítem que pasó a `single_choice` no
 * lo rechaza este esquema laxo por ser incoherente, lo rechaza el `strictObject`
 * del documento publicado, meses después y lejos de quien lo escribió.
 */
export function defaultItemConfig(responseType: ResponseType): Record<string, unknown> {
  // `finding` es una prescripción autoral, no configuración de respuesta: los ítems nacen sin ella.
  switch (responseType) {
    case 'yes_no':
    case 'yes_no_na':
      return { fails_on: 'no' };
    case 'scale':
      return { min: 1, max: 5 };
    case 'text':
      return { max_length: 500 };
    case 'number':
      return { min: 0, max: 100, decimals: 0 };
    case 'single_choice':
      return { options: [] };
    case 'multi_choice':
      return { options: [], min_selected: 0, max_selected: 1 };
    case 'photo':
      return { min_count: 0, max_count: 3 };
    default:
      return {};
  }
}
