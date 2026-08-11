import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores del reporte de cumplimiento.
 *
 * Mismo criterio que `findings.errors.ts`: el código va en el CUERPO y no solo en el
 * status, para que el cliente decida sin parsear un mensaje.
 */
export type ComplianceErrorCode = 'report_not_found' | 'forbidden' | 'render_not_available';

export class ComplianceException extends HttpException {
  constructor(
    readonly code: ComplianceErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Una sola respuesta para «no existe» y «es de la otra planta»: la política RLS hace que
 * las dos se vean igual desde el servicio, y distinguirlas convertiría el endpoint en un
 * oráculo de qué reportes tiene la planta donde el solicitante no tiene alcance.
 */
export const reportNotFound = (): ComplianceException =>
  new ComplianceException(
    'report_not_found',
    'No such compliance report within your scope',
    HttpStatus.NOT_FOUND,
  );

/** Generar evidencia regulatoria es del coordinador (§4, tabla de roles). */
export const complianceForbidden = (message: string): ComplianceException =>
  new ComplianceException('forbidden', message, HttpStatus.FORBIDDEN);

/**
 * El reporte existe y su PDF no. Es un estado normal —el render corre después del
 * request y puede fallar—, así que se responde `404` sobre el archivo y no un `500`: no
 * hay nada roto, hay algo que todavía no está.
 */
export const renderNotAvailable = (): ComplianceException =>
  new ComplianceException(
    'render_not_available',
    'This report has no rendered document yet',
    HttpStatus.NOT_FOUND,
  );
