import { HttpException, HttpStatus } from '@nestjs/common';
import type { Violation } from '@hs/forms';

/**
 * Los errores de la ingesta de envíos.
 *
 * **ESTOS CÓDIGOS NO SE ELIGEN ACÁ: YA LOS ELIGIÓ EL DISPOSITIVO.**
 * `apps/web/src/offline/outbox.ts` clasifica la respuesta por código y decide con eso
 * qué hace con la entrada de la cola:
 *
 *   validation_failed · invalid_submission · forbidden · inspection_not_found
 *       → NO reintentable. La entrada se detiene, se muestra con su motivo, y el
 *         borrador queda legible en el dispositivo.
 *   already_submitted
 *       → se trata como éxito: el registro existe, que es todo lo que la cola quería.
 *   cualquier otro código
 *       → reintenta con retroceso, para siempre.
 *
 * Esa última línea es el motivo de que este archivo exista y de que no se le agreguen
 * códigos por comodidad: un código que el outbox no conoce es un teléfono golpeando
 * este endpoint cada cinco minutos hasta que alguien mire.
 *
 * El código va en el CUERPO y no solo en el status, igual que en `auth.errors.ts`.
 */
export type SubmissionErrorCode =
  | 'already_submitted'
  | 'invalid_submission'
  | 'validation_failed'
  | 'forbidden'
  | 'inspection_not_found';

export class SubmissionException extends HttpException {
  constructor(
    readonly code: SubmissionErrorCode,
    message: string,
    status: HttpStatus,
    extra?: Record<string, unknown>,
  ) {
    super({ code, message, ...extra }, status);
  }
}

/**
 * Una sola respuesta para "no existe" y "es de la otra planta". La política RLS hace
 * que las dos se vean igual desde el servicio, y distinguirlas convertiría el endpoint
 * en un oráculo de qué se inspecciona en la planta donde el solicitante no tiene
 * alcance. Mismo criterio y mismo texto que `inspections.errors.ts`.
 */
export const submissionInspectionNotFound = (): SubmissionException =>
  new SubmissionException(
    'inspection_not_found',
    'No such inspection record within your scope',
    HttpStatus.NOT_FOUND,
  );

/**
 * El envío es de quien lo firma, y de nadie más: un dueño, un dispositivo, un firmante
 * (§4). Cubre también la inspección sin inspector asignado — no hay nadie a quien le
 * corresponda, así que no le corresponde a nadie.
 */
export const notTheAssignedInspector = (message: string): SubmissionException =>
  new SubmissionException('forbidden', message, HttpStatus.FORBIDDEN);

/**
 * El período ya tiene su envío. **No es un `409`**: el `409` estaría bien para un
 * humano y acá lo que lee la respuesta es una cola de salida, que trata este código
 * como "ya está, borrá la entrada". Un reenvío del MISMO `client_submission_id` no
 * llega a este error — devuelve el registro existente.
 */
export const alreadySubmitted = (): SubmissionException =>
  new SubmissionException(
    'already_submitted',
    'This inspection has already been submitted',
    HttpStatus.CONFLICT,
  );

/**
 * El envío no se puede aceptar por algo que no son las respuestas: la versión no es la
 * congelada, el período está cancelado, una object key es de otra inspección, o la
 * misma `item_key` vino en `answers` y en `photos`.
 */
export const invalidSubmission = (message: string): SubmissionException =>
  new SubmissionException('invalid_submission', message, HttpStatus.BAD_REQUEST);

/**
 * Las respuestas no pasan el motor. **Van TODAS las violaciones**, no la primera: el
 * inspector tiene que ver de una vez todo lo que le falta, no descubrirlo de a un
 * envío rechazado por vez. Es la misma decisión que toma `validateAnswers`, sostenida
 * hasta la respuesta HTTP.
 *
 * `422` y no `400`: el cuerpo se entendió perfectamente, es su contenido el que no
 * corresponde a la plantilla. Para el outbox los dos son igual de no reintentables.
 */
export const validationFailed = (violations: readonly Violation[]): SubmissionException =>
  new SubmissionException(
    'validation_failed',
    'The answers do not satisfy the template version',
    HttpStatus.UNPROCESSABLE_ENTITY,
    { violations },
  );
