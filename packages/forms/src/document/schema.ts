import { z } from 'zod';

import { referencedItemKeys, visibleWhenSchema, type VisibleWhen } from './conditions.js';
import { findingSchema } from './finding.js';
import { ITEM_KEY_PATTERN, SECTION_KEY_PATTERN } from './keys.js';

/**
 * Requisitos §4 — El documento de una versión de plantilla publicada.
 *
 * Este esquema es la fuente de verdad de la **forma** del documento. Lo consume
 * el cliente (que nunca ve el esquema Drizzle, ADR-007), lo consume el motor de
 * validación de este mismo paquete, y lo consume la suite de integración para
 * verificar que todo seed publicado parsea. `@hs/contracts` lo re-exporta.
 *
 * Lo que este esquema NO puede validar es todo lo que depende del estado de la
 * base: que la `item_key` esté registrada, que no esté desactivada, que la
 * versión sea la siguiente. Eso son claves foráneas y triggers en
 * `apps/api/drizzle/0003_template_model.sql`. Zod valida la forma; el motor
 * valida las referencias.
 */

export { ITEM_KEY_PATTERN, SECTION_KEY_PATTERN } from './keys.js';

/**
 * Los nueve tipos de respuesta de v1. El scoring ponderado salió de v1
 * (requisitos §5 riesgo E), así que un ítem no lleva peso.
 *
 * El orden es estable a propósito: la migración `0007` escribe esta misma lista
 * en el `CHECK` de `template_version_item.response_type` y un test de
 * integración compara las dos. SQL no puede importar TypeScript; la duplicación
 * es deliberada y está bajo prueba.
 */
export const RESPONSE_TYPES = [
  'yes_no',
  'yes_no_na',
  'scale',
  'text',
  'number',
  'single_choice',
  'multi_choice',
  'photo',
  'signature',
] as const;

export const responseTypeSchema = z.enum(RESPONSE_TYPES);

export type ResponseType = z.infer<typeof responseTypeSchema>;

/**
 * Campos que todo ítem tiene, sin importar cómo se responda.
 *
 * Un ítem sin `visible_when` es siempre visible. Que la key referenciada exista
 * y aparezca antes se verifica a nivel documento, más abajo: la condición sola
 * no sabe en qué documento vive.
 */
const itemBase = {
  item_key: z
    .string()
    .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores'),
  prompt: z.string().min(1),
  position: z.number().int().positive(),
  required: z.boolean(),
  visible_when: visibleWhenSchema.optional(),
  // El esquema estricto también debe conocerlo: de lo contrario draftIssues lo marcaría como genérico.
  finding: findingSchema.optional(),
};

/** Una opción de un ítem de selección. `value` es lo que se guarda; `label`, lo que se lee. */
export const choiceOptionSchema = z.strictObject({
  value: z.string().min(1),
  label: z.string().min(1),
});

export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

/**
 * Un `strictObject` por tipo de respuesta, y no un objeto plano con todos los
 * campos opcionales: un ítem de texto que trae `options` no es un ítem al que le
 * sobra un campo, es un ítem que alguien escribió mal. Tiene que romper CI y no
 * descubrirse en la primera inspección.
 */
const yesNoItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('yes_no'),
  fails_on: z.enum(['yes', 'no']).default('no'),
});

/**
 * Los cinco modos de fallo de `yes_no_na`: cuál o cuáles de las tres respuestas
 * cuentan como incumplimiento. `na` puede ser parte de la falla —a diferencia de
 * `yes_no`, acá el autor puede decidir que "no aplica" también amerita
 * revisión— pero siempre acompañada de `yes` o `no`, nunca las tres juntas: un
 * ítem que falla con cualquier respuesta no es una pregunta de cumplimiento.
 */
export const YES_NO_NA_FAILS_ON = ['no', 'yes', 'no_na', 'na', 'yes_na'] as const;

export const yesNoNaFailsOnSchema = z.enum(YES_NO_NA_FAILS_ON);

export type YesNoNaFailsOn = z.infer<typeof yesNoNaFailsOnSchema>;

const yesNoNaItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('yes_no_na'),
  fails_on: yesNoNaFailsOnSchema.default('no'),
});

const scaleItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('scale'),
  min: z.number().int(),
  max: z.number().int(),
});

const textItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('text'),
  max_length: z.number().int().positive(),
});

const numberItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('number'),
  min: z.number(),
  max: z.number(),
  decimals: z.number().int().min(0),
});

const singleChoiceItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('single_choice'),
  options: z.array(choiceOptionSchema).min(1),
});

const multiChoiceItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('multi_choice'),
  options: z.array(choiceOptionSchema).min(1),
  min_selected: z.number().int().min(0),
  max_selected: z.number().int().min(1),
});

/**
 * La respuesta de un `photo` son object keys, no blobs (ADR-001): las fotos se
 * suben antes del envío con presigned URLs y el envío las referencia.
 */
const photoItem = z.strictObject({
  ...itemBase,
  response_type: z.literal('photo'),
  min_count: z.number().int().min(0),
  max_count: z.number().int().min(1),
});

/** Misma razón que `photo`: la firma viaja como object key, no dentro del payload. */
const signatureItem = z.strictObject({ ...itemBase, response_type: z.literal('signature') });

/**
 * Devuelve los valores que aparecen más de una vez, en orden de aparición.
 */
function duplicates<T>(values: readonly T[]): T[] {
  const seen = new Set<T>();
  const repeated = new Set<T>();

  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }

    seen.add(value);
  }

  return [...repeated];
}

/**
 * Coherencia entre los campos de configuración de un mismo ítem. La unión ya
 * garantizó que estén los campos correctos y con el tipo correcto; acá se
 * verifica que digan algo posible.
 */
function checkItemConfig(item: RawTemplateItem, ctx: z.RefinementCtx): void {
  switch (item.response_type) {
    case 'scale':
      if (item.min >= item.max) {
        ctx.addIssue({
          code: 'custom',
          path: ['min'],
          message: `scale: min (${item.min}) tiene que ser menor que max (${item.max})`,
        });
      }

      break;

    case 'number':
      if (item.min > item.max) {
        ctx.addIssue({
          code: 'custom',
          path: ['min'],
          message: `number: min (${item.min}) no puede ser mayor que max (${item.max})`,
        });
      }

      break;

    case 'single_choice':
    case 'multi_choice': {
      for (const value of duplicates(item.options.map((option) => option.value))) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: `options: el value "${value}" aparece más de una vez`,
        });
      }

      if (item.response_type === 'multi_choice') {
        if (item.min_selected > item.max_selected) {
          ctx.addIssue({
            code: 'custom',
            path: ['min_selected'],
            message: `multi_choice: min_selected (${item.min_selected}) no puede ser mayor que max_selected (${item.max_selected})`,
          });
        }

        if (item.max_selected > item.options.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['max_selected'],
            message: `multi_choice: max_selected (${item.max_selected}) supera la cantidad de options (${item.options.length})`,
          });
        }

        if (item.min_selected > item.options.length) {
          ctx.addIssue({
            code: 'custom',
            path: ['min_selected'],
            message: `multi_choice: min_selected (${item.min_selected}) supera la cantidad de options (${item.options.length})`,
          });
        }
      }

      break;
    }

    case 'photo':
      if (item.min_count > item.max_count) {
        ctx.addIssue({
          code: 'custom',
          path: ['min_count'],
          message: `photo: min_count (${item.min_count}) no puede ser mayor que max_count (${item.max_count})`,
        });
      }

      break;

    default:
      break;
  }
}

const rawTemplateItemSchema = z.discriminatedUnion('response_type', [
  yesNoItem,
  yesNoNaItem,
  scaleItem,
  textItem,
  numberItem,
  singleChoiceItem,
  multiChoiceItem,
  photoItem,
  signatureItem,
]);

type RawTemplateItem = z.infer<typeof rawTemplateItemSchema>;

export const templateItemSchema = rawTemplateItemSchema.superRefine(checkItemConfig);

export type TemplateItem = z.infer<typeof templateItemSchema>;

/** El ítem de un `response_type` concreto: `TemplateItemOf<'scale'>` trae `min` y `max`. */
export type TemplateItemOf<T extends ResponseType> = Extract<TemplateItem, { response_type: T }>;

export const templateSectionSchema = z.strictObject({
  section_key: z
    .string()
    .regex(SECTION_KEY_PATTERN, 'section_key: minúsculas, dígitos y "." o "-" como separadores'),
  section_title: z.string().min(1),
  /** Optional only for historical versions created before the organization catalog. */
  organization_location_code: z.string().min(1).optional(),
  position: z.number().int().positive(),
  visible_when: visibleWhenSchema.optional(),
  items: z.array(templateItemSchema).min(1),
});

export type TemplateSection = z.infer<typeof templateSectionSchema>;

export const templateDocumentSchema = z
  .strictObject({
    sections: z.array(templateSectionSchema).min(1),
  })
  .superRefine((document, ctx) => {
    for (const key of duplicates(document.sections.map((section) => section.section_key))) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `section_key duplicada en el documento: "${key}"`,
      });
    }

    for (const position of duplicates(document.sections.map((section) => section.position))) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `dos secciones comparten la position ${position}`,
      });
    }

    document.sections.forEach((section, index) => {
      // Dos ítems en la misma posición dentro de una sección hacen que el orden
      // del formulario dependa de cómo lo ordene el motor. Es el mismo único
      // (template_version_id, section_key, position) que tiene la tabla.
      for (const position of duplicates(section.items.map((item) => item.position))) {
        ctx.addIssue({
          code: 'custom',
          path: ['sections', index, 'items'],
          message: `sección "${section.section_key}": dos ítems comparten la position ${position}`,
        });
      }
    });

    // Una `item_key` repetida dentro de un documento haría que la misma pregunta
    // se conteste dos veces en la misma inspección y que la recurrencia contara
    // doble. Es único a nivel documento, no a nivel sección.
    const itemKeys = document.sections.flatMap((section) =>
      section.items.map((item) => item.item_key),
    );

    for (const key of duplicates(itemKeys)) {
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `item_key duplicada en el documento: "${key}"`,
      });
    }

    checkConditionReferences(document, ctx);
  });

/**
 * Toda `item_key` que una `visible_when` referencia tiene que existir en el
 * documento y aparecer **estrictamente antes** en orden de documento.
 *
 * Es la restricción que hace que la visibilidad se resuelva en una sola pasada
 * hacia adelante: sin ciclos que detectar y sin que el resultado dependa del
 * orden en que se evalúen los ítems. Una plantilla que la viole no se publica.
 */
function checkConditionReferences(
  document: { sections: TemplateSection[] },
  ctx: z.RefinementCtx,
): void {
  const sectionsInOrder = [...document.sections].sort((a, b) => a.position - b.position);

  /** `item_key` -> su lugar en el orden de documento. */
  const order = new Map<string, number>();
  /** `section_key` -> el lugar del primer ítem de la sección. */
  const sectionStart = new Map<string, number>();

  let index = 0;

  for (const section of sectionsInOrder) {
    sectionStart.set(section.section_key, index);

    for (const item of [...section.items].sort((a, b) => a.position - b.position)) {
      order.set(item.item_key, index);
      index += 1;
    }
  }

  /**
   * `boundary` es el lugar a partir del cual la referencia ya sería "hacia
   * adelante": el del propio ítem, o el del primer ítem de la sección — una
   * sección solo puede depender de secciones anteriores.
   */
  function check(
    visibleWhen: VisibleWhen | undefined,
    boundary: number,
    path: (string | number)[],
    subject: string,
  ): void {
    if (!visibleWhen) return;

    for (const key of referencedItemKeys(visibleWhen)) {
      const referenced = order.get(key);

      if (referenced === undefined) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `${subject}: visible_when referencia una item_key que el documento no contiene: "${key}"`,
        });

        continue;
      }

      if (referenced >= boundary) {
        ctx.addIssue({
          code: 'custom',
          path,
          message: `${subject}: visible_when referencia "${key}", que aparece después en el documento`,
        });
      }
    }
  }

  document.sections.forEach((section, sectionIndex) => {
    check(
      section.visible_when,
      sectionStart.get(section.section_key) ?? 0,
      ['sections', sectionIndex, 'visible_when'],
      `sección "${section.section_key}"`,
    );

    section.items.forEach((item, itemIndex) => {
      check(
        item.visible_when,
        order.get(item.item_key) ?? 0,
        ['sections', sectionIndex, 'items', itemIndex, 'visible_when'],
        `ítem "${item.item_key}"`,
      );
    });
  });
}

export type TemplateDocument = z.infer<typeof templateDocumentSchema>;

/**
 * El documento en orden de documento: secciones por `position`, y dentro de cada
 * una sus ítems por `position`.
 *
 * Es el orden que usan la evaluación de visibilidad y la validación. Que sea una
 * sola función y no un `sort` repetido en cada módulo es lo que garantiza que
 * "antes en el documento" signifique lo mismo en todos lados.
 */
export function sectionsInDocumentOrder(
  document: TemplateDocument,
): [TemplateSection, TemplateItem[]][] {
  return [...document.sections]
    .sort((a, b) => a.position - b.position)
    .map((section) => [section, [...section.items].sort((a, b) => a.position - b.position)]);
}

/** Los ítems del documento en orden de documento, sin las secciones. */
export function itemsInDocumentOrder(document: TemplateDocument): TemplateItem[] {
  return sectionsInDocumentOrder(document).flatMap(([, items]) => items);
}
