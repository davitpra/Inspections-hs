import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

/**
 * El cuerpo que no es del contrato: `400 invalid_request`, nunca un `500`.
 *
 * Todos los controladores validan con `schema.parse(body)` en crudo. Sin este filtro un
 * cuerpo mal formado sale por el manejador por defecto de Nest como **500 con el stack
 * del `ZodError` en el log**, y eso rompe dos cosas a la vez:
 *
 *   - El operador ve un error de servidor donde hubo un error del cliente.
 *   - **El outbox no puede clasificarlo.** `readError` de `session-client.ts` no
 *     encuentra código tipado en un `500`, devuelve `session_ended` por defecto, y
 *     `classify` termina en `retryLater`. Un envío que el servidor NUNCA va a aceptar
 *     —una descripción de hallazgo de dos letras— queda reintentando con retroceso para
 *     siempre desde el teléfono de un inspector.
 *
 * De ahí que el código viaje en el CUERPO y esté en el `NON_RETRYABLE` del outbox: la
 * cola tiene que poder detener la entrada y mostrarle al inspector qué arreglar.
 *
 * `invalid_request` y no `invalid_submission`/`validation_failed`: el filtro es global y
 * cubre todos los endpoints, y esos dos códigos son vocabulario de la ingesta de envíos
 * —`validation_failed` es el `422` que lleva las violaciones del motor de formularios—.
 * Acá el cuerpo ni siquiera llegó a tener la forma del contrato, que es un `400`.
 *
 * `issues` lleva `path`, `code` y `message`, y NINGÚN valor recibido: nombrar el campo
 * que falla es lo que el cliente necesita, devolver lo que mandó es filtrar de vuelta
 * datos que pueden ser de una planta.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter<ZodError> {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();

    response.status(HttpStatus.BAD_REQUEST).json({
      code: 'invalid_request',
      message: 'The request body does not match the contract',
      issues: exception.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });
  }
}
