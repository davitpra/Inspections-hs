import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores propios de la programación de inspecciones.
 *
 * Mismo criterio que `auth.errors.ts`: el código va en el CUERPO y no solo en el
 * status, para que el cliente pueda decidir sin parsear un mensaje en inglés.
 */
export type SchedulingErrorCode =
  | 'inspection_not_found'
  | 'inspector_invalid'
  | 'template_not_publishable';

export class SchedulingException extends HttpException {
  constructor(
    readonly code: SchedulingErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Una sola respuesta para "no existe" y "está fuera de tu alcance", y es deliberado:
 * la política RLS hace que las dos se vean igual desde acá, y distinguirlas
 * convertiría el endpoint en un oráculo de qué se programa en la otra planta.
 */
export const inspectionNotFound = (): SchedulingException =>
  new SchedulingException(
    'inspection_not_found',
    'No such inspection record within your scope',
    HttpStatus.NOT_FOUND,
  );

/** El mensaje nombra qué falta: el rol, o el sitio. Es lo que el coordinador arregla. */
export const inspectorInvalid = (message: string): SchedulingException =>
  new SchedulingException('inspector_invalid', message, HttpStatus.BAD_REQUEST);

export const templateNotPublishable = (templateId: string): SchedulingException =>
  new SchedulingException(
    'template_not_publishable',
    `Template ${templateId} has no published version to inspect against`,
    HttpStatus.BAD_REQUEST,
  );
