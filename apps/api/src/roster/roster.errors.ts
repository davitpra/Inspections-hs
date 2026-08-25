import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores propios de la consola y la importación del roster.
 *
 * Mismo criterio que `inspections.errors.ts` y `auth.errors.ts`: el código va en el
 * CUERPO y no solo en el status, para que el cliente pueda decidir sin parsear un mensaje
 * en inglés.
 *
 * **No hay un `person_not_found`** y no es un olvido: no hay ninguna ruta que reciba el id
 * de una persona. Pedir el roster de una planta fuera del alcance devuelve una lista
 * vacía, que es lo que ya hace la política RLS por su cuenta.
 */
export type RosterErrorCode =
  | 'roster_forbidden'
  | 'roster_file_unusable'
  | 'roster_file_too_large';

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
 * persona *sin poder ver su perfil*, y un roster de solo lectura para un supervisor es
 * exactamente esa ficha. Que la consola no escriba nada no relaja esto: el riesgo de §4 está
 * en la LECTURA, no en la escritura.
 */
export const rosterForbidden = (): RosterException =>
  new RosterException(
    'roster_forbidden',
    'Only the HS coordinator can read the roster',
    HttpStatus.FORBIDDEN,
  );

export const rosterImportForbidden = (): RosterException =>
  new RosterException(
    'roster_forbidden',
    'Only the HS coordinator can import the roster',
    HttpStatus.FORBIDDEN,
  );

export const rosterFileUnusable = (reason: string): RosterException =>
  new RosterException('roster_file_unusable', `The roster file is unusable: ${reason}`, HttpStatus.BAD_REQUEST);

export const rosterFileTooLarge = (): RosterException =>
  new RosterException(
    'roster_file_too_large',
    'The roster file must not exceed 2 MiB',
    HttpStatus.PAYLOAD_TOO_LARGE,
  );
