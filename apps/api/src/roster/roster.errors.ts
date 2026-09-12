import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores propios de la consola, el alta a mano y la importación del roster.
 *
 * Mismo criterio que `inspections.errors.ts` y `auth.errors.ts`: el código va en el
 * CUERPO y no solo en el status, para que el cliente pueda decidir sin parsear un mensaje
 * en inglés.
 *
 * `person_employee_number_taken` y `person_site_out_of_scope` sí nombran a una persona
 * porque el alta (`add-person-to-roster-by-hand`) sí escribe. El primero no dice si la
 * persona que ya tiene ese número está en una planta que el llamador administra (design
 * D3): un solo código para los dos casos, para que el formulario no se pueda usar como
 * oráculo de números de empleado ajenos.
 */
export type RosterErrorCode =
  | 'roster_forbidden'
  | 'roster_file_unusable'
  | 'roster_file_too_large'
  | 'person_employee_number_taken'
  | 'person_site_out_of_scope'
  | 'person_not_found'
  | 'person_has_active_account'
  | 'person_not_active';

export class RosterException extends HttpException {
  constructor(
    readonly code: RosterErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Leer el roster entero es del coordinador.
 *
 * A diferencia de la consola de programación —que deja mirar a cualquiera y solo condiciona
 * la escritura—, acá el `GET` también pasa por esta comprobación: §4 dice que se elige a una
 * persona *sin poder ver su perfil*, y un roster de solo lectura para un miembro del JHSC es
 * exactamente esa ficha. Que la consola no escriba nada no relaja esto: el riesgo de §4 está
 * en la LECTURA, no en la escritura.
 */
export const rosterForbidden = (): RosterException =>
  new RosterException(
    'roster_forbidden',
    'Only the HS coordinator can view people and access',
    HttpStatus.FORBIDDEN,
  );

export const rosterImportForbidden = (): RosterException =>
  new RosterException(
    'roster_forbidden',
    'Only the HS coordinator can import people',
    HttpStatus.FORBIDDEN,
  );

export const rosterFileUnusable = (reason: string): RosterException =>
  new RosterException('roster_file_unusable', `The people CSV file is unusable: ${reason}`, HttpStatus.BAD_REQUEST);

export const rosterFileTooLarge = (): RosterException =>
  new RosterException(
    'roster_file_too_large',
    'The people CSV file must not exceed 2 MiB',
    HttpStatus.PAYLOAD_TOO_LARGE,
  );

/**
 * El número de empleado ya existe. El mensaje nombra solo el número que el llamador
 * tipeó — nada de la persona que ya lo tiene (design D3): ni su nombre, ni su planta, ni
 * si está activa. Es la misma respuesta venga la colisión de una persona dentro del
 * alcance del llamador o de una que no ve.
 */
export const personEmployeeNumberTaken = (employeeNumber: string): RosterException =>
  new RosterException(
    'person_employee_number_taken',
    `employee_number "${employeeNumber}" is already in use`,
    HttpStatus.CONFLICT,
  );

/**
 * El `site_id` del alta no está en el alcance de la sesión (design D4). A diferencia de
 * `GET /people`, acá el chequeo es explícito porque este endpoint ESCRIBE: dejarlo en
 * manos de RLS convertiría un pedido mal dirigido en un 500, que es un error del motor,
 * no la respuesta correcta a un `site_id` que el llamador no administra.
 */
export const personSiteOutOfScope = (): RosterException =>
  new RosterException(
    'person_site_out_of_scope',
    'site_id is outside of the session scope',
    HttpStatus.FORBIDDEN,
  );

/** RLS hace indistinguibles una persona inexistente y una fuera del alcance. */
export const personNotFound = (): RosterException =>
  new RosterException('person_not_found', 'Person not found', HttpStatus.NOT_FOUND);

export const personHasActiveAccount = (): RosterException =>
  new RosterException(
    'person_has_active_account',
    'A person with an active account cannot be deactivated from the roster',
    HttpStatus.CONFLICT,
  );

export const personNotActive = (): RosterException =>
  new RosterException('person_not_active', 'This person is already inactive', HttpStatus.CONFLICT);
