import { HttpException, HttpStatus } from '@nestjs/common';
import type { DatabaseError } from 'pg';

/**
 * Los errores del módulo de acciones correctivas.
 *
 * Mismo criterio que `findings.errors.ts`: el código va en el CUERPO y no solo en el
 * status, para que el cliente decida sin parsear un mensaje.
 *
 * Ninguno de estos códigos lo lee el outbox. Una acción correctiva se ejecuta online
 * (design D15): no hay dispositivo reintentando en un rincón sin señal.
 */
export type ActionErrorCode =
  | 'action_not_found'
  | 'invalid_due_at'
  | 'invalid_assignee'
  | 'invalid_transition'
  | 'invalid_action_state'
  | 'invalid_evidence'
  | 'verifier_is_executor'
  | 'action_changed'
  | 'forbidden';

export class ActionException extends HttpException {
  constructor(
    readonly code: ActionErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/**
 * Una sola respuesta para "no existe" y "es de la otra planta": la política RLS hace
 * que las dos se vean igual desde el servicio, y distinguirlas convertiría el endpoint
 * en un oráculo de qué se está arreglando en la planta donde el solicitante no tiene
 * alcance (§6 pregunta 5).
 */
export const actionNotFound = (): ActionException =>
  new ActionException('action_not_found', 'No such action within your scope', HttpStatus.NOT_FOUND);

/** La fecha límite tiene que ser posterior al momento de creación. */
export const invalidDueAt = (): ActionException =>
  new ActionException(
    'invalid_due_at',
    'The due date must be later than the moment the assignment is saved',
    HttpStatus.BAD_REQUEST,
  );

/** La persona responsable no existe, no es de este sitio, o está dada de baja. */
export const invalidAssignee = (message: string): ActionException =>
  new ActionException('invalid_assignee', message, HttpStatus.BAD_REQUEST);

/** El par (estado actual, destino) no está en la máquina de estados. */
export const invalidTransition = (message: string): ActionException =>
  new ActionException('invalid_transition', message, HttpStatus.CONFLICT);

/**
 * Una corrección sobre una acción cuyo trabajo ya se declaró hecho (ADR-021). El motor la
 * rechaza con `HS014`.
 */
export const invalidActionState = (): ActionException =>
  new ActionException(
    'invalid_action_state',
    'An action assignment cannot be edited once the work is declared done; refuse the verification to correct it',
    HttpStatus.CONFLICT,
  );

/** Una object key que no pertenece al prefijo de esta acción. */
export const invalidEvidence = (message: string): ActionException =>
  new ActionException('invalid_evidence', message, HttpStatus.BAD_REQUEST);

/** §3 R3: quien ejecutó no verifica — salvo una cuenta administrativa (ADR-019, ADR-025). */
export const verifierIsExecutor = (): ActionException =>
  new ActionException(
    'verifier_is_executor',
    'A corrective action is verified by someone other than whoever did the work, unless they are an administrator',
    HttpStatus.FORBIDDEN,
  );

/**
 * Dos transiciones concurrentes desde el mismo estado: una comete y la otra viola el
 * único de `(action_id, position)`.
 *
 * Se traduce a esto y no a un `23505` sin traducir, por lo mismo que
 * `already_reclassified` en hallazgos: quien pierde tiene que entender que alguien más
 * movió la acción mientras él miraba, y que lo que corresponde es releer y decidir otra
 * vez — no reintentar a ciegas.
 */
export const actionChanged = (): ActionException =>
  new ActionException(
    'action_changed',
    'This action was advanced by someone else; reload it and try again',
    HttpStatus.CONFLICT,
  );

export const actionForbidden = (message: string): ActionException =>
  new ActionException('forbidden', message, HttpStatus.FORBIDDEN);

/**
 * La traducción de los SQLSTATE de la migración 0011.
 *
 * El servicio comprueba las mismas cosas antes, para devolver un mensaje legible; esto
 * existe para el caso en que el motor gane la carrera —dos requests concurrentes— y
 * para que un fallo de guarda nunca salga como un 500 sin explicación. Que las dos
 * capas digan lo mismo es lo que los tests de integración afirman por los dos caminos.
 */
export function translatePgError(error: unknown): ActionException | undefined {
  const candidate = error as DatabaseError | undefined;

  switch (candidate?.code) {
    case 'HS003':
      return invalidAssignee('The assignee must be active and belong to the action site');
    case 'HS004':
      return invalidTransition(candidate.message);
    case 'HS005':
      return verifierIsExecutor();
    case 'HS007':
      // No hay camino por el que un request llegue acá: el servicio escribe la acción y
      // su primer evento en la misma transacción. Se traduce igual porque un 500 mudo
      // en un registro regulatorio es peor que un 409 que sobra.
      return invalidTransition('An action must be created with its first event');
    case 'HS008':
      return actionChanged();
    case 'HS014':
      // El servicio ya comprobó el estado bajo el lock; esto cubre la carrera con
      // `Start work` que gane el motor, y cualquier otro camino a la tabla.
      return invalidActionState();
    case '23505':
      return candidate.constraint === 'corrective_action_event_position_uq' ||
        candidate.constraint === 'finding_state_event_position_uq'
        ? actionChanged()
        : undefined;
    default:
      return undefined;
  }
}
