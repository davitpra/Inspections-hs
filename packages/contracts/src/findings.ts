import { ITEM_KEY_PATTERN } from '@hs/forms';
import { z } from 'zod';

/**
 * Requisitos §7 etapa 4 — El hallazgo y su clasificación de riesgo.
 *
 * Un hallazgo nace de una respuesta negativa durante la ingesta, o de la entrada
 * manual de un supervisor (§5 riesgo F). En los dos casos lleva descripción,
 * ubicación del catálogo cerrado y al menos una foto: es el R2 de §3, y sin los
 * tres el hallazgo no sirve para abrir una acción correctiva.
 *
 * Lo que estos esquemas NO pueden validar es todo lo que depende del estado: que
 * la ubicación exista y sea del sitio, que el hallazgo exista, que quien
 * clasifica sea el coordinador, que la clasificación que se supera sea la
 * vigente. Eso son FKs, políticas RLS y triggers en
 * `apps/api/drizzle/0010_findings.sql`. Zod valida la forma.
 */

const itemKeySchema = z
  .string()
  .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores');

/** La misma forma que en `submissions.ts`: una key del bucket, nunca bytes (ADR-001). */
const objectKeySchema = z.string().min(1).max(512);

// ---------------------------------------------------------------------------
// Las escalas de la matriz

/**
 * Las cuatro listas cerradas de la clasificación.
 *
 * **Las mismas cuatro están escritas como `CHECK` en la migración 0010**, y un
 * test de integración las compara. SQL no puede importar TypeScript; la
 * duplicación es deliberada y está bajo prueba, igual que la de `RESPONSE_TYPES`
 * en 0007.
 *
 * El orden es significativo: es el índice 1..5 con el que la matriz de
 * `hs_risk_level` y de `apps/api/src/findings/risk.ts` calculan el nivel.
 */
export const PROBABILITIES = ['rare', 'unlikely', 'possible', 'likely', 'almost_certain'] as const;

export const SEVERITIES = ['negligible', 'minor', 'moderate', 'major', 'catastrophic'] as const;

/** Derivado de los dos anteriores. **Nunca viaja en un request** (design D5). */
export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;

/**
 * La jerarquía de controles de R2, de la más efectiva a la menos. El sistema
 * registra el nivel de la solución propuesta y **no la juzga**: que la respuesta
 * a un riesgo crítico haya sido un par de guantes es exactamente el dato que
 * hace falta poder ver después.
 */
export const CONTROL_LEVELS = [
  'elimination',
  'substitution',
  'engineering',
  'administrative',
  'ppe',
] as const;

export const probabilitySchema = z.enum(PROBABILITIES);
export const severitySchema = z.enum(SEVERITIES);
export const riskLevelSchema = z.enum(RISK_LEVELS);
export const controlLevelSchema = z.enum(CONTROL_LEVELS);

export type Probability = z.infer<typeof probabilitySchema>;
export type Severity = z.infer<typeof severitySchema>;
export type RiskLevel = z.infer<typeof riskLevelSchema>;
export type ControlLevel = z.infer<typeof controlLevelSchema>;

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
// Clasificar

/**
 * Lo que el coordinador aporta al clasificar.
 *
 * **`risk_level` no está y esa ausencia es el requisito**: lo calcula el motor a
 * partir de los otros dos y no hay forma de escribirlo desde afuera (D5).
 *
 * `reason` es obligatorio al reclasificar y está prohibido al clasificar por
 * primera vez. Acá viaja opcional porque el request no sabe cuál de las dos
 * cosas es —lo sabe el servidor, que ya leyó la vigente— y el `CHECK` de la
 * migración es la barrera final.
 */
export const riskAssessmentRequestSchema = z.strictObject({
  probability: probabilitySchema,
  severity: severitySchema,
  control_level: controlLevelSchema,
  reason: z.string().trim().min(10).max(2000).optional(),
});

export type RiskAssessmentRequest = z.infer<typeof riskAssessmentRequestSchema>;

/** Una clasificación, tal como se lee. */
export const riskAssessmentSchema = z.strictObject({
  id: z.uuid(),
  probability: probabilitySchema,
  severity: severitySchema,
  /** Calculado por el motor. Se lee, no se escribe. */
  risk_level: riskLevelSchema,
  control_level: controlLevelSchema,
  reason: z.string().nullable(),
  supersedes_id: z.uuid().nullable(),
  assessed_by: z.uuid(),
  assessed_at: z.iso.datetime({ offset: true }),
});

export type RiskAssessment = z.infer<typeof riskAssessmentSchema>;

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
 * Nace clasificado. Un hallazgo derivado puede esperar al coordinador porque el
 * inspector no clasifica; acá quien reporta ya está en la aplicación y con la
 * lista delante.
 */
export const manualFindingRequestSchema = z.strictObject({
  site_id: z.uuid(),
  draft_finding_id: z.uuid(),
  details: findingDetailsSchema,
  /** Cuándo se vio, que no es cuándo se cargó. Mismo criterio que `signed_at`. */
  occurred_at: z.iso.datetime({ offset: true }),
  classification: riskAssessmentRequestSchema.omit({ reason: true }),
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
 * motor a partir de `prior_count`, igual que `risk_level` (D5).
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
 * `assessment` en `null` significa **sin clasificar**, que es un estado derivado
 * de que no exista ninguna fila y no un valor guardado en ningún lado (D10). No
 * hay campo `status` y esa ausencia es deliberada.
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
  assessment: riskAssessmentSchema.nullable(),

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
