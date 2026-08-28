import { ITEM_KEY_PATTERN } from '@hs/forms';
import { z } from 'zod';

/**
 * Requisitos §7 etapa 4 — El hallazgo.
 *
 * Un hallazgo nace de una respuesta negativa durante la ingesta, o de la entrada
 * manual de un supervisor (§5 riesgo F). En los dos casos lleva descripción,
 * ubicación del catálogo cerrado y al menos una foto: es el R2 de §3, y sin los
 * tres el hallazgo no sirve para abrir una acción correctiva.
 *
 * **El hallazgo no se clasifica.** La matriz de probabilidad × severidad y el
 * nivel de la jerarquía de controles se retiraron antes de producción; ver
 * ADR-014. De un hallazgo sale una acción correctiva con la fecha límite que el
 * coordinador declara, sin ningún paso intermedio.
 *
 * Lo que estos esquemas NO pueden validar es todo lo que depende del estado: que
 * la ubicación exista y sea del sitio, que el hallazgo exista. Eso son FKs,
 * políticas RLS y triggers en `apps/api/drizzle/0010_findings.sql`. Zod valida la
 * forma.
 */

const itemKeySchema = z
  .string()
  .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores');

/** La misma forma que en `submissions.ts`: una key del bucket, nunca bytes (ADR-001). */
const objectKeySchema = z.string().min(1).max(512);

/** De dónde nació el hallazgo. Determina si tiene `item_key` o no. */
export const FINDING_ORIGINS = ['inspection', 'manual'] as const;

export const findingOriginSchema = z.enum(FINDING_ORIGINS);

export type FindingOrigin = z.infer<typeof findingOriginSchema>;

// ---------------------------------------------------------------------------
// Lo que el campo aporta

/**
 * El mínimo de la descripción no es cosmético: "ok" o "malo" en un registro
 * inmutable que puede terminar en un expediente del MLITSD no describe nada, y
 * quien lo lee tres meses después no estuvo ahí. El mismo mínimo está escrito
 * como `CHECK` en la migración.
 */
export const FINDING_DESCRIPTION_MIN = 10;
export const FINDING_DESCRIPTION_MAX = 2000;

/**
 * Lo que el inspector describe al responder que no, o el supervisor al reportar
 * un peligro: los tres datos obligatorios de R2.
 *
 * `photo_object_keys` con `min(1)` es la foto obligatoria del contrato; el motor
 * la exige otra vez con una restricción diferida, porque una lista vacía no es
 * la única forma de llegar a un hallazgo sin fotos.
 */
export const findingDetailsSchema = z.strictObject({
  description: z.string().trim().min(FINDING_DESCRIPTION_MIN).max(FINDING_DESCRIPTION_MAX),
  location_id: z.uuid().nullable(),
  photo_object_keys: z.array(objectKeySchema).min(1).max(10),
});

export type FindingDetails = z.infer<typeof findingDetailsSchema>;

/**
 * El bloque de hallazgos de un envío, por `item_key`.
 *
 * Viaja aparte de `answers` y aparte de `photos`: fundirlo en `photos` chocaría
 * con la respuesta del propio ítem —`mergePhotoAnswers` rechaza esa colisión— y
 * meterlo dentro del valor de la respuesta ensancharía el motor de formularios
 * con un concepto que no le pertenece.
 */
export const submissionFindingsSchema = z.record(itemKeySchema, findingDetailsSchema);

export type SubmissionFindings = z.infer<typeof submissionFindingsSchema>;

// ---------------------------------------------------------------------------
// La entrada manual

/**
 * El hallazgo que no nace de una inspección: el peligro que un supervisor ve al
 * pasar, o el casi-accidente que presenció (§5 riesgo F).
 *
 * `draft_finding_id` lo genera el cliente **antes de subir la primera foto**,
 * igual que `client_submission_id`: es lo que le da a las fotos un prefijo propio
 * en el bucket cuando no hay inspección programada de la que colgar.
 *
 * Lleva exactamente lo mismo que uno derivado, porque es lo mismo: un peligro
 * descrito, ubicado y fotografiado. El objeto es estricto, así que un
 * `classification` de un cliente viejo se rechaza en vez de ignorarse.
 */
export const manualFindingRequestSchema = z.strictObject({
  site_id: z.uuid(),
  draft_finding_id: z.uuid(),
  details: findingDetailsSchema,
  /** Cuándo se vio, que no es cuándo se cargó. Mismo criterio que `signed_at`. */
  occurred_at: z.iso.datetime({ offset: true }),
});

export type ManualFindingRequest = z.infer<typeof manualFindingRequestSchema>;

// ---------------------------------------------------------------------------
// La marca de recurrencia

/**
 * Lo que el hallazgo sabía de su propia historia **en el momento de nacer**
 * (etapa 7, design D1 y D2).
 *
 * Se calcula dentro de la misma transacción que inserta el hallazgo y no se vuelve
 * a tocar nunca: es un hecho fechado, no un cálculo que se repite. Por eso lleva
 * `window_months` — el que la lee tiene que saber con qué ventana se calculó, y
 * puede no ser la del reporte que está mirando. Que `prior_count` diga 3 y la
 * serie de la vista diga 6 es correcto y está previsto.
 *
 * **`is_recurrent` no viaja en ningún request**: es una columna generada por el
 * motor a partir de `prior_count`, y se lee, no se escribe (D5).
 *
 * LA DISTINCIÓN QUE ESTE ESQUEMA EXISTE PARA SOSTENER, y que se pierde si alguien
 * decide "simplificar" el nulable:
 *
 *   `recurrence: null`            → hallazgo manual. NUNCA se comparó con la historia.
 *   `is_recurrent: false`         → se comparó, y es la primera vez.
 *
 * Colapsar los dos a `false` afirmaría que el hallazgo manual pasó por la
 * comparación, y no pasa: sin `item_key` no hay serie a la que pertenecer. Es el
 * punto ciego que §6-bis pregunta 11 dejó escrito, y el contrato tiene que dejarlo
 * visible en vez de taparlo (D8).
 */
export const findingRecurrenceSchema = z.strictObject({
  /** Cuántos hallazgos previos de la misma `item_key` y ubicación, si quedó resuelta. */
  prior_count: z.number().int().min(0),

  /** Cuántos de la misma `item_key` en cualquier ubicación del sitio. */
  prior_count_site_wide: z.number().int().min(0),

  /** La ventana con la que se contaron los dos anteriores, en meses. */
  window_months: z.number().int().min(1).max(60),

  /** El `occurred_at` del más viejo de los previos. `null` cuando no hubo ninguno. */
  first_prior_occurred_at: z.iso.datetime({ offset: true }).nullable(),

  /** Calculado por el motor como `prior_count > 0`. Se lee, no se escribe. */
  is_recurrent: z.boolean(),
});

export type FindingRecurrence = z.infer<typeof findingRecurrenceSchema>;

// ---------------------------------------------------------------------------
// Lo que se lee

/**
 * Un hallazgo tal como lo devuelve la API.
 *
 * No hay campo `status` y esa ausencia es deliberada: un hallazgo no tiene
 * estado propio. Lo que se hizo con él son sus acciones correctivas, que se leen
 * por su cuenta.
 *
 * Los tres campos de la identidad dual son nulables juntos: los tres tienen
 * valor en un hallazgo derivado y los tres son `null` en uno manual. El `CHECK`
 * de la migración impide cualquier combinación intermedia.
 */
export const findingSchema = z.strictObject({
  id: z.uuid(),
  site_id: z.uuid(),
  origin: findingOriginSchema,
  inspection_id: z.uuid().nullable(),
  template_version_item_id: z.uuid().nullable(),
  item_key: itemKeySchema.nullable(),
  location_id: z.uuid().nullable(),
  description: z.string(),
  photo_object_keys: z.array(objectKeySchema),
  reported_by: z.uuid(),
  occurred_at: z.iso.datetime({ offset: true }),
  recorded_at: z.iso.datetime({ offset: true }),

  /**
   * `null` en un hallazgo manual —y en uno anterior a la migración 0013, que no
   * tiene marca y no la va a tener—. Ver `findingRecurrenceSchema`: la ausencia y
   * `is_recurrent: false` dicen cosas distintas.
   */
  recurrence: findingRecurrenceSchema.nullable(),
});

export type Finding = z.infer<typeof findingSchema>;

export const findingListSchema = z.array(findingSchema);

export type FindingList = z.infer<typeof findingListSchema>;
