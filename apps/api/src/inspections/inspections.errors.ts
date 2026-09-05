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
  | 'schedule_already_active'
  | 'schedule_must_be_deactivated'
  | 'schedule_must_be_restored'
  | 'schedule_restore_conflict'
  | 'template_not_publishable'
  | 'version_not_advanceable'
  | 'visibility_not_advanceable';

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

/**
 * Ya hay una regla activa para esa planta y esa plantilla.
 *
 * El único parcial de 0008 es el que manda; esto solo traduce su `23505` a algo que se
 * pueda mostrar. **No se comprueba antes del INSERT**, a propósito: dos altas
 * concurrentes pasarían las dos comprobaciones y chocarían igual, así que el único es la
 * respuesta y esta función es la traducción.
 *
 * `409` y no `400`: la petición es válida, es el estado del sistema el que la rechaza.
 */
export const scheduleAlreadyActive = (siteId: string, templateId: string): SchedulingException =>
  new SchedulingException(
    'schedule_already_active',
    `Site ${siteId} already has an active schedule rule for template ${templateId}`,
    HttpStatus.CONFLICT,
  );

export const scheduleMustBeDeactivated = (): SchedulingException =>
  new SchedulingException(
    'schedule_must_be_deactivated',
    'Deactivate this inspection requirement in a separate change before archiving it',
    HttpStatus.CONFLICT,
  );

export const scheduleMustBeRestored = (): SchedulingException =>
  new SchedulingException(
    'schedule_must_be_restored',
    'Restore this inspection requirement before reactivating it',
    HttpStatus.CONFLICT,
  );

export const scheduleRestoreConflict = (
  siteId: string,
  templateId: string,
): SchedulingException =>
  new SchedulingException(
    'schedule_restore_conflict',
    `Another non-archived inspection requirement exists for site ${siteId} and template ${templateId}`,
    HttpStatus.CONFLICT,
  );

export const templateNotPublishable = (templateId: string): SchedulingException =>
  new SchedulingException(
    'template_not_publishable',
    `Template ${templateId} has no published version to inspect against`,
    HttpStatus.BAD_REQUEST,
  );

export type VersionAdvanceReason = 'submitted' | 'cancelled' | 'no_newer_version';

export const versionNotAdvanceable = (reason: VersionAdvanceReason): SchedulingException => {
  const messages: Record<VersionAdvanceReason, string> = {
    submitted: 'This inspection was already submitted and cannot change template version',
    cancelled: 'This inspection was cancelled and cannot change template version',
    no_newer_version: 'There is no newer published version to advance to',
  };

  return new SchedulingException(
    'version_not_advanceable',
    messages[reason],
    HttpStatus.CONFLICT,
  );
};

export type VisibilityAdvanceReason =
  | 'already_visible'
  | 'cancelled'
  | 'not_assigned'
  | 'not_future'
  | 'submitted';

export const visibilityNotAdvanceable = (
  reason: VisibilityAdvanceReason,
): SchedulingException => {
  const messages: Record<VisibilityAdvanceReason, string> = {
    already_visible: 'This inspection is already visible to its inspector',
    cancelled: 'This inspection was cancelled and cannot change visibility',
    not_assigned: 'Assign an inspector before making this inspection visible',
    not_future: 'This inspection is already visible because its period has started',
    submitted: 'This inspection was already submitted and cannot change visibility',
  };

  return new SchedulingException(
    'visibility_not_advanceable',
    messages[reason],
    HttpStatus.CONFLICT,
  );
};
