import { ITEM_KEY_PATTERN, signatureAnswerSchema } from '@hs/forms';
import { z } from 'zod';

import { submissionFindingsSchema } from './findings.js';

/**
 * Requisitos §7 etapa 3 — Lo que sale del dispositivo: la subida de una foto y el
 * envío de la inspección.
 *
 * Este archivo es el contrato que las dos mitades del spike 1 comparten. El
 * dispositivo lo usa para armar el payload (`offline-inspection-capture`) y el
 * servidor lo usará para recibirlo (`submission-ingestion-endpoint`). Que sean el
 * mismo esquema es lo que hace que un desajuste aparezca en un test de contrato y no
 * en 48 acres sin señal.
 *
 * Lo que este esquema NO puede validar es todo lo que depende del estado: que la
 * inspección exista, que sea del alcance de quien envía, que la `template_version_id`
 * sea la congelada, que las respuestas sean válidas contra ese documento. Lo primero
 * son FKs y RLS; lo último es `validateAnswers` de `@hs/forms`. Zod valida la forma.
 */

const itemKeySchema = z
  .string()
  .regex(ITEM_KEY_PATTERN, 'item_key: minúsculas, dígitos y "." o "-" como separadores');

/**
 * Una object key del bucket. La deriva el servidor y el cliente la devuelve tal cual:
 * acá solo se comprueba que sea una cadena y no bytes disfrazados.
 */
const objectKeySchema = z.string().min(1).max(512);

// ---------------------------------------------------------------------------
// Presign

/**
 * ADR-006 — Solo fotos, y solo los dos formatos que una cámara de Android produce.
 * La lista es cerrada porque la URL firmada fija el `content-type`: aceptar cualquier
 * cosa sería firmar la subida de cualquier cosa.
 */
export const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png'] as const;

export const uploadContentTypeSchema = z.enum(UPLOAD_CONTENT_TYPES);

export type UploadContentType = z.infer<typeof uploadContentTypeSchema>;

/**
 * El tope de una foto. No hay compresión ni redimensionado en v1 (Non-Goal de
 * `design.md`), así que el tope es el de una foto de cámara sin tocar, con margen.
 */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Pedir permiso para subir UNA foto, justo antes de subirla (design D7).
 *
 * **La object key no viaja en el request y esa ausencia es el requisito**: la deriva
 * el servidor como `{site_id}/{scheduled_inspection_id}/{uuid}`. Dejar que el
 * dispositivo elija dónde escribe es dejar que escriba encima de otra inspección.
 */
export const presignUploadRequestSchema = z.strictObject({
  scheduled_inspection_id: z.uuid(),
  item_key: itemKeySchema,
  content_type: uploadContentTypeSchema,
  content_length: z.int().positive().max(MAX_UPLOAD_BYTES),
});

export type PresignUploadRequest = z.infer<typeof presignUploadRequestSchema>;

/**
 * El mismo permiso, para la foto de un hallazgo de entrada manual (design D9).
 *
 * Un hallazgo manual no cuelga de ninguna inspección programada, así que no
 * puede usar su prefijo. El servidor deriva `{site_id}/manual/{draft_finding_id}/
 * {uuid}` y el cliente sigue sin elegir dónde escribe: `draft_finding_id` lo
 * genera antes de subir la primera foto, igual que `client_submission_id`.
 *
 * Sin `item_key`: un hallazgo manual no tiene ítem, que es justamente lo que lo
 * deja fuera de la detección de recurrencia (§5 riesgo F).
 */
export const presignFindingUploadRequestSchema = z.strictObject({
  site_id: z.uuid(),
  draft_finding_id: z.uuid(),
  content_type: uploadContentTypeSchema,
  content_length: z.int().positive().max(MAX_UPLOAD_BYTES),
});

export type PresignFindingUploadRequest = z.infer<typeof presignFindingUploadRequestSchema>;

/**
 * La URL firmada, su key y cuándo deja de servir. `expires_at` viaja para que el
 * dispositivo pueda decidir que una URL guardada ya no sirve sin tener que pedirla y
 * comerse el error — aunque el camino normal es pedirla y usarla en el acto.
 */
export const presignUploadResponseSchema = z.strictObject({
  url: z.url(),
  object_key: objectKeySchema,
  expires_at: z.iso.datetime({ offset: true }),
});

export type PresignUploadResponse = z.infer<typeof presignUploadResponseSchema>;

// ---------------------------------------------------------------------------
// El envío

/**
 * El valor de una respuesta, en la forma que `@hs/forms` define por `response_type`:
 * `yes_no` es booleano, `scale` y `number` son números, `text` y `single_choice` son
 * cadenas, `multi_choice` y `photo` son listas de cadenas, `signature` es la object
 * key con su reloj.
 *
 * La unión es cerrada a propósito. **Un blob no parsea**, y no porque se lo filtre:
 * porque no hay rama de esta unión que lo acepte. Es la forma de que ADR-001 —el
 * envío referencia object keys y NUNCA lleva bytes— sea una propiedad del contrato y
 * no una convención que alguien recuerde respetar.
 */
export const answerValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.string()),
  signatureAnswerSchema,
]);

export type AnswerValue = z.infer<typeof answerValueSchema>;

/**
 * El envío de una inspección completada y firmada.
 *
 * `client_submission_id` es la clave de idempotencia del sistema entero: lo genera el
 * dispositivo con el borrador —no al enviar— y no cambia nunca. Reenviarlo devuelve el
 * registro existente en vez de crear otro (ADR-001), que es lo que hace que reintentar
 * sobre la red de una planta sea seguro.
 *
 * `photos` va aparte de `answers` y lleva **object keys**: las fotos se suben con
 * presigned URLs ANTES del envío, y el envío las referencia. Sin bytes de imagen acá,
 * un envío pesa kilobytes y cabe en la ventana de red que el inspector tenga.
 */
export const inspectionSubmissionSchema = z.strictObject({
  client_submission_id: z.uuid(),
  scheduled_inspection_id: z.uuid(),
  /**
   * La versión congelada contra la que el dispositivo interpretó el formulario. Viaja
   * para que el servidor pueda rechazar un envío armado contra otra: no es el cliente
   * eligiendo versión, es el cliente declarando cuál usó.
   */
  template_version_id: z.uuid(),
  answers: z.record(itemKeySchema, answerValueSchema),
  photos: z.record(itemKeySchema, z.array(objectKeySchema)),
  /**
   * Los detalles del hallazgo de cada respuesta negativa (requisitos §3 R2,
   * etapa 4). Las claves tienen que ser **exactamente** las de `negativeAnswers`
   * de `@hs/forms`: una de menos es `finding_missing`, una de más es
   * `unexpected_finding`, y las dos son `validation_failed`.
   *
   * Va aparte de `photos` a propósito. Si las fotos del hallazgo viajaran ahí,
   * `mergePhotoAnswers` las fundiría en `answers` bajo la misma `item_key` y
   * chocarían con el booleano de la respuesta — que es la colisión que esa
   * función ya rechaza, y hace bien en rechazar.
   */
  findings: submissionFindingsSchema,
  /** El reloj del dispositivo. El servidor guarda además el suyo (§5 riesgo C). */
  signed_at: z.iso.datetime({ offset: true }),
});

export type InspectionSubmission = z.infer<typeof inspectionSubmissionSchema>;

/**
 * Lo que el servidor devuelve al aceptar: el registro creado **o el existente**.
 *
 * `created` distingue los dos casos sin cambiar el status ni la forma. Para el
 * dispositivo los dos significan lo mismo —el registro existe, la entrada del outbox
 * se puede borrar— y por eso un reenvío no es un `409`.
 */
export const acceptedSubmissionSchema = z.strictObject({
  id: z.uuid(),
  client_submission_id: z.uuid(),
  scheduled_inspection_id: z.uuid(),
  template_version_id: z.uuid(),
  submitted_at: z.iso.datetime({ offset: true }),
  submitted_by: z.uuid(),
  /** `false` cuando el envío ya había sido aceptado y esto es el registro de entonces. */
  created: z.boolean(),
});

export type AcceptedSubmission = z.infer<typeof acceptedSubmissionSchema>;
