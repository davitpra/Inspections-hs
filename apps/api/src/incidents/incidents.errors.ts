import { HttpException, HttpStatus } from '@nestjs/common';
import type { DatabaseError } from 'pg';

/**
 * Los errores del módulo de incidentes.
 *
 * Mismo criterio que `actions.errors.ts` y `findings.errors.ts`: el código va en el
 * CUERPO y no solo en el status, para que el cliente decida sin parsear un mensaje.
 *
 * Ninguno de estos códigos lo lee el outbox. **Un incidente se carga online** (design
 * D14): se reporta desde una oficina o un teléfono con señal, no desde el fondo del
 * invernadero a mitad de un recorrido. Un incidente esperando sincronización sería peor
 * que uno cargado veinte minutos más tarde, porque los relojes del MLITSD corren desde
 * el evento y un reporte demorado en un dispositivo sería invisible para todos.
 */
export type IncidentErrorCode =
  | 'incident_not_found'
  | 'person_not_active'
  | 'first_person_report_not_supported'
  | 'occurred_at_in_future'
  | 'invalid_location'
  | 'invalid_transition'
  | 'investigation_required'
  | 'root_cause_required'
  | 'incident_has_open_actions'
  | 'investigation_not_open'
  | 'incident_changed'
  | 'forbidden';

export class IncidentException extends HttpException {
  constructor(
    readonly code: IncidentErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Una sola respuesta para "no existe", "es de la otra planta" y "no te toca verlo".
 *
 * Las tres se ven igual desde el servicio porque las tres las produce la política RLS —
 * la de sitio y la `RESTRICTIVE` de visibilidad—, y distinguirlas convertiría el
 * endpoint en un oráculo de qué accidentes ocurrieron donde el solicitante no alcanza.
 * Para un incidente eso importa más que para cualquier otra tabla: confirmar la
 * existencia de un incidente ya dice que alguien se lastimó.
 */
export const incidentNotFound = (): IncidentException =>
  new IncidentException(
    'incident_not_found',
    'No such incident within your scope',
    HttpStatus.NOT_FOUND,
  );

/** El sujeto o un testigo no existe en el alcance, es de otra planta, o está dado de baja. */
export const personNotActive = (message: string): IncidentException =>
  new IncidentException('person_not_active', message, HttpStatus.BAD_REQUEST);

/**
 * El reporte en primera persona está fuera de alcance de v1, por decisión explícita.
 *
 * No es una limitación técnica: §3 R4 describe el recorrido en tercera persona y §2 lo
 * deja fuera. Se responde con un código propio en vez de un 400 genérico para que quede
 * dicho que el sistema entendió lo que se pidió y que la respuesta es "eso no existe
 * acá", no "te faltó un campo".
 */
export const firstPersonReport = (): IncidentException =>
  new IncidentException(
    'first_person_report_not_supported',
    'An incident is reported about somebody else; first person reporting is out of scope',
    HttpStatus.BAD_REQUEST,
  );

/**
 * Un evento no puede haber ocurrido después de haber sido reportado.
 *
 * Sin esto, un `occurred_at` en el futuro correría los plazos del MLITSD hacia adelante
 * y el sistema mostraría un plazo que la ley no da.
 */
export const occurredAtInFuture = (): IncidentException =>
  new IncidentException(
    'occurred_at_in_future',
    'The incident cannot have occurred after it was reported',
    HttpStatus.BAD_REQUEST,
  );

export const invalidLocation = (): IncidentException =>
  new IncidentException(
    'invalid_location',
    'No such active location at this site',
    HttpStatus.BAD_REQUEST,
  );

/** El par (estado actual, destino) no está en la máquina de estados. */
export const invalidTransition = (message: string): IncidentException =>
  new IncidentException('invalid_transition', message, HttpStatus.CONFLICT);

/**
 * Tres clasificaciones no pueden ir de `reported` a `closed` (§4).
 *
 * La lista es **configuración en código y no regla legal autoritativa**: §4 exige
 * confirmarla contra las obligaciones concretas del empleador bajo la OHSA antes de
 * producción.
 */
export const investigationRequired = (): IncidentException =>
  new IncidentException(
    'investigation_required',
    'This classification requires an investigation before the incident can be closed',
    HttpStatus.CONFLICT,
  );

/** Una investigación sin causa raíz es una carpeta vacía con un nombre. */
export const rootCauseRequired = (): IncidentException =>
  new IncidentException(
    'root_cause_required',
    'Record at least one root cause before closing the investigation',
    HttpStatus.CONFLICT,
  );

/**
 * **La guarda que da sentido a la máquina de estados** (pregunta cerrada 7).
 *
 * Hace que el estado del incidente sea una consecuencia del trabajo real y no una
 * declaración administrativa.
 */
export const incidentHasOpenActions = (): IncidentException =>
  new IncidentException(
    'incident_has_open_actions',
    'Close the corrective actions of this incident before closing the incident',
    HttpStatus.CONFLICT,
  );

export const investigationNotOpen = (): IncidentException =>
  new IncidentException(
    'investigation_not_open',
    'This incident has no open investigation to record causes on',
    HttpStatus.CONFLICT,
  );

/** Alguien más movió el incidente entre que se leyó su estado y se escribió el evento. */
export const incidentChanged = (): IncidentException =>
  new IncidentException(
    'incident_changed',
    'The incident moved while this request was in flight; read it again',
    HttpStatus.CONFLICT,
  );

export const incidentForbidden = (message: string): IncidentException =>
  new IncidentException('forbidden', message, HttpStatus.FORBIDDEN);

/**
 * La traducción de los SQLSTATE de la migración 0012.
 *
 * El servicio comprueba las mismas cosas antes, para devolver un mensaje legible; esto
 * existe para el caso en que el motor gane la carrera —dos requests concurrentes, uno
 * cerrando la última acción y otro cerrando el incidente— y para que un fallo de guarda
 * nunca salga como un 500 sin explicación. Que las dos capas digan lo mismo es lo que
 * los tests de integración afirman por los dos caminos.
 */
export function translatePgError(error: unknown): IncidentException | undefined {
  const candidate = error as DatabaseError | undefined;

  switch (candidate?.code) {
    case 'HS008':
      return invalidTransition(candidate.message);
    case 'HS009':
      return incidentHasOpenActions();
    case 'HS010':
      return investigationRequired();
    case 'HS011':
      return rootCauseRequired();
    case 'HS012':
      // No hay camino por el que un request llegue acá: el servicio escribe el
      // incidente y su primer evento, y la transición y su investigación, en la misma
      // transacción. Se traduce igual porque un 500 mudo en un registro regulatorio es
      // peor que un 409 que sobra.
      return invalidTransition(candidate.message);
    case '23505':
      return candidate.constraint === 'incident_event_position_uq'
        ? incidentChanged()
        : undefined;
    default:
      return undefined;
  }
}
