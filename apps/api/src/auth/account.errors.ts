import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores propios del alta de una cuenta (`POST /accounts`, proposal — "La ruta no
 * crea personas y no crea credenciales").
 *
 * Mismo criterio que `roster.errors.ts` y `auth.errors.ts`: el código va en el CUERPO y
 * no solo en el status.
 *
 * `account_out_of_scope` es la respuesta legible de HS002 (design D3): el motor ya frena
 * la escritura si un sitio del alcance pedido queda fuera del alcance del actor —eso no
 * se duplica en un `if`—, pero el error crudo del trigger no dice nada que el coordinador
 * pueda leer, así que acá se traduce.
 */
export type AccountErrorCode =
  | 'account_forbidden'
  | 'account_person_not_found'
  | 'account_already_exists'
  | 'account_email_taken'
  | 'account_out_of_scope'
  | 'account_not_found'
  | 'account_already_active'
  | 'account_role_not_removable'
  | 'account_already_inactive'
  | 'account_promotion_forbidden'
  | 'account_role_not_promotable'
  | 'account_promotion_inactive'
  | 'account_promotion_self'
  | 'account_demotion_forbidden'
  | 'account_role_not_demotable'
  | 'account_demotion_inactive'
  | 'account_demotion_self';

export class AccountException extends HttpException {
  constructor(
    readonly code: AccountErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

export const accountForbidden = (): AccountException =>
  new AccountException(
    'account_forbidden',
     'Only the coordinator can create an account',
    HttpStatus.FORBIDDEN,
  );

export const accountPersonNotFound = (): AccountException =>
  new AccountException(
    'account_person_not_found',
    'No person matches that id, or it is outside your scope',
    HttpStatus.BAD_REQUEST,
  );

export const accountAlreadyExists = (): AccountException =>
  new AccountException(
    'account_already_exists',
    'This person already holds an account',
    HttpStatus.CONFLICT,
  );

export const accountEmailTaken = (): AccountException =>
  new AccountException(
    'account_email_taken',
    'That email already belongs to another account',
    HttpStatus.CONFLICT,
  );

export const accountOutOfScope = (): AccountException =>
  new AccountException(
    'account_out_of_scope',
    "The requested scope reaches a site outside the coordinator's own scope",
    HttpStatus.FORBIDDEN,
  );

/**
 * `GET /accounts/:id` y `PATCH /accounts/:id` (`reissue-invitation-link-from-roster`,
 * design D6): no existe, o su `person` queda fuera del alcance de la sesión — la política
 * de `person` ya hace que la segunda no distinga de la primera, así que no hay dos
 * mensajes que puedan servir de oráculo.
 */
export const accountNotFound = (): AccountException =>
  new AccountException(
    'account_not_found',
    'No account matches that id, or it is outside your scope',
    HttpStatus.NOT_FOUND,
  );

/**
 * `PATCH /accounts/:id` (design D5): la cuenta ya tiene credencial activa. Reemitir un
 * link o corregir el correo por esta vía queda cerrado a propósito — es la toma de
 * control que el reinicio de contraseña, un acto aparte con su propia confirmación,
 * reserva para sí.
 */
export const accountAlreadyActive = (): AccountException =>
  new AccountException(
    'account_already_active',
    'This account can already sign in; use the credential reset instead',
    HttpStatus.CONFLICT,
  );

/**
 * `PATCH /accounts/:id` con `deactivated` (`remove-jhsc-access-from-roster`): el roster
 * administra el acceso que el roster otorgó, y eso es exactamente `inspector`. Una
 * una cuenta administrativa se da de baja por el camino que la dio de alta, con su propia
 * confirmación — quitar de una lista de doscientas filas al coordinador de la planta de al
 * lado no puede ser un clic.
 */
export const accountRoleNotRemovable = (): AccountException =>
  new AccountException(
    'account_role_not_removable',
     'Only an inspector account can have access removed here',
    HttpStatus.FORBIDDEN,
  );

/**
 * `PATCH /accounts/:id` con `deactivated: true` sobre una cuenta que ya está inactiva. No
 * es idempotencia mal entendida: dos coordinadores dando de baja a la vez escribirían dos
 * `deactivated_at` distintos y dos entradas de auditoría del mismo hecho, y la segunda
 * pisaría la fecha en la que el acceso realmente terminó.
 */
export const accountAlreadyInactive = (): AccountException =>
  new AccountException(
    'account_already_inactive',
    'This account is already inactive',
    HttpStatus.CONFLICT,
  );

export const accountPromotionForbidden = (): AccountException =>
  new AccountException(
    'account_promotion_forbidden',
     'Only management can promote an account to coordinator',
    HttpStatus.FORBIDDEN,
  );

export const accountRoleNotPromotable = (role: string): AccountException =>
  new AccountException(
    'account_role_not_promotable',
     `Role ${role} cannot be promoted to coordinator`,
    HttpStatus.CONFLICT,
  );

export const accountPromotionInactive = (): AccountException =>
  new AccountException(
    'account_promotion_inactive',
     'An inactive account cannot be promoted to coordinator',
    HttpStatus.CONFLICT,
  );

export const accountPromotionSelf = (): AccountException =>
  new AccountException(
    'account_promotion_self',
     'You cannot promote your own account to coordinator',
    HttpStatus.FORBIDDEN,
  );

export const accountDemotionForbidden = (): AccountException =>
  new AccountException(
    'account_demotion_forbidden',
     'Only management can demote an account to inspector',
    HttpStatus.FORBIDDEN,
  );

export const accountRoleNotDemotable = (role: string): AccountException =>
  new AccountException(
    'account_role_not_demotable',
     `Role ${role} cannot be demoted to inspector`,
    HttpStatus.CONFLICT,
  );

export const accountDemotionInactive = (): AccountException =>
  new AccountException(
    'account_demotion_inactive',
     'An inactive account cannot be demoted to inspector',
    HttpStatus.CONFLICT,
  );

export const accountDemotionSelf = (): AccountException =>
  new AccountException(
    'account_demotion_self',
     'You cannot demote your own account to inspector',
    HttpStatus.FORBIDDEN,
  );
