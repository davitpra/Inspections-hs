import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores del módulo de hallazgos.
 *
 * Mismo criterio que `inspections.errors.ts` y `auth.errors.ts`: el código va en el
 * CUERPO y no solo en el status, para que el cliente decida sin parsear un mensaje.
 *
 * Estos códigos NO los lee el outbox: los hallazgos manuales y las clasificaciones se
 * cargan online, con una persona mirando la pantalla. Los del envío siguen siendo los
 * de `submissions.errors.ts`, que sí están fijados por el dispositivo.
 */
export type FindingErrorCode =
  'finding_not_found' | 'invalid_finding' | 'forbidden';

export class FindingException extends HttpException {
  constructor(
    readonly code: FindingErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Una sola respuesta para "no existe" y "es de la otra planta": la política RLS hace
 * que las dos se vean igual desde el servicio, y distinguirlas convertiría el endpoint
 * en un oráculo de qué se encontró en la planta donde el solicitante no tiene alcance
 * (§6 pregunta 5).
 */
export const findingNotFound = (): FindingException =>
  new FindingException(
    'finding_not_found',
    'No such finding within your scope',
    HttpStatus.NOT_FOUND,
  );

/**
 * El hallazgo no se puede aceptar por algo que no es su forma: la ubicación está
 * desactivada, es de otra planta, o una object key no pertenece a este hallazgo.
 */
export const invalidFinding = (message: string): FindingException =>
  new FindingException('invalid_finding', message, HttpStatus.BAD_REQUEST);

/** Reportar a mano es de quien supervisa (§4 roles). */
export const findingForbidden = (message: string): FindingException =>
  new FindingException('forbidden', message, HttpStatus.FORBIDDEN);
