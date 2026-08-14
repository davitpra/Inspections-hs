import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Los errores propios de la consola del roster. Uno solo, porque la consola es de solo
 * lectura y lo único que puede salir mal es quién pregunta.
 *
 * Mismo criterio que `inspections.errors.ts` y `auth.errors.ts`: el código va en el
 * CUERPO y no solo en el status, para que el cliente pueda decidir sin parsear un mensaje
 * en inglés.
 *
 * **No hay un `person_not_found`** y no es un olvido: no hay ninguna ruta que reciba el id
 * de una persona. Pedir el roster de una planta fuera del alcance devuelve una lista
 * vacía, que es lo que ya hace la política RLS por su cuenta.
 */
export type RosterErrorCode = 'roster_forbidden';

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
