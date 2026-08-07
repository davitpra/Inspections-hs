import { z } from 'zod';

/**
 * Requisitos §4 — El documento de una versión de plantilla publicada.
 *
 * Este esquema es la fuente de verdad de la **forma** del documento. Lo consume
 * el cliente (que nunca ve el esquema Drizzle, ADR-007) y lo consume la suite de
 * integración para verificar que todo seed publicado parsea.
 *
 * Lo que este esquema NO puede validar es todo lo que depende del estado de la
 * base: que la `item_key` esté registrada, que no esté desactivada, que la
 * versión sea la siguiente. Eso son claves foráneas y triggers en
 * `apps/api/drizzle/0003_template_model.sql`. Zod valida la forma; el motor
 * valida las referencias.
 */

/**
 * `item_key` legible y no opaca: los seeds se escriben a mano y la key aparece
 * en el reporte de recurrencia que lee el coordinador. Minúsculas, dígitos, y
 * `.` o `-` como separadores entre segmentos — nunca al principio ni al final.
 *
 * El mismo patrón está escrito como `CHECK` en la migración 0003. Si uno cambia,
 * el otro también.
 */
export const ITEM_KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/** Mismo formato que `item_key`, por las mismas razones. */
export const SECTION_KEY_PATTERN = ITEM_KEY_PATTERN;

/**
 * Los cuatro tipos de respuesta de v1. El scoring ponderado salió de v1
 * (requisitos §5 riesgo E), así que un ítem no lleva peso.
 */
export const RESPONSE_TYPES = ['yes_no', 'scale', 'text', 'number'] as const;

export const responseTypeSchema = z.enum(RESPONSE_TYPES);

export type ResponseType = z.infer<typeof responseTypeSchema>;

/**
 * `strictObject` y no `object`: un seed con `respose_type` mal escrito tiene que
 * romper CI, no quedar con el default y descubrirse en la primera inspección.
 */
export const templateItemSchema = z.strictObject({
  item_key: z
    .string()
    .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores'),
  prompt: z.string().min(1),
  position: z.number().int().positive(),
  response_type: responseTypeSchema,
  required: z.boolean(),
});

export type TemplateItem = z.infer<typeof templateItemSchema>;

export const templateSectionSchema = z.strictObject({
  section_key: z
    .string()
    .regex(SECTION_KEY_PATTERN, 'section_key: minúsculas, dígitos y "." o "-" como separadores'),
  section_title: z.string().min(1),
  position: z.number().int().positive(),
  items: z.array(templateItemSchema).min(1),
});

export type TemplateSection = z.infer<typeof templateSectionSchema>;

/** Devuelve los valores que aparecen más de una vez, en orden de aparición. */
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
  });

export type TemplateDocument = z.infer<typeof templateDocumentSchema>;
