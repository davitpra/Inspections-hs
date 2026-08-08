import { HttpException, HttpStatus } from '@nestjs/common';
import type { AuthErrorCode } from '@hs/contracts';

/**
 * ADR-011, design D5 — Los tres desenlaces de una llamada autenticada, tipados.
 *
 * El código va en el CUERPO y no solo en el status, y eso es el requisito y no una
 * preferencia: `token_expired` y `session_ended` son los dos `401`, y el cliente que
 * vacía el outbox tiene que poder separarlos para decidir entre "refrescá y
 * reintentá" y "pedí login, pero no descartes nada". Distinguirlos parseando un
 * mensaje en inglés sería frágil, y lo que se rompería es la cola de una inspección
 * de tres horas.
 *
 * Ningún código significa "descartá la entrada". El servidor no tiene forma de saber
 * si algo de la cola es descartable, así que no lo decide nunca.
 */
export class AuthException extends HttpException {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}

/** El access token venció y el refresh puede estar vivo. RENOVABLE. */
export const tokenExpired = (): AuthException =>
  new AuthException('token_expired', 'The access token has expired', HttpStatus.UNAUTHORIZED);

/**
 * La sesión terminó y no vuelve: revocada, cuenta desactivada o vencida, refresh
 * vencido. NO renovable — y aun así, nada de la cola se descarta.
 */
export const sessionEnded = (message = 'The session has ended'): AuthException =>
  new AuthException('session_ended', message, HttpStatus.UNAUTHORIZED);

/**
 * Deliberadamente el mismo error para email inexistente y contraseña incorrecta: el
 * spec exige que las dos respuestas sean indistinguibles, porque si no lo fueran esta
 * ruta sería un verificador de qué direcciones tienen cuenta.
 *
 * También cubre la cuenta desactivada, la vencida y la que no tiene credencial: los
 * cinco casos comparten respuesta por el mismo motivo.
 */
export const invalidCredentials = (): AuthException =>
  new AuthException('invalid_credentials', 'Invalid email or password', HttpStatus.UNAUTHORIZED);

export const accountLocked = (): AuthException =>
  new AuthException(
    'account_locked',
    'Too many failed attempts. Try again later.',
    HttpStatus.TOO_MANY_REQUESTS,
  );

export const twoFactorRequired = (): AuthException =>
  new AuthException(
    'two_factor_required',
    'A valid second-factor code is required',
    HttpStatus.UNAUTHORIZED,
  );

/** La sesión limitada de design D7 usada fuera de sus dos rutas. */
export const twoFactorEnrolmentRequired = (): AuthException =>
  new AuthException(
    'two_factor_enrolment_required',
    'Enrol a second factor before using this account',
    HttpStatus.FORBIDDEN,
  );

/** Sesión válida, rol o alcance insuficiente. Ni refresca ni reintenta. */
export const forbidden = (message = 'Not allowed'): AuthException =>
  new AuthException('forbidden', message, HttpStatus.FORBIDDEN);

/**
 * Una sola respuesta para "no existe", "venció", "ya se usó" y "fue revocada", por el
 * mismo motivo que `invalidCredentials`: distinguirlas convertiría la ruta en un
 * oráculo de qué tokens existieron.
 */
export const invitationInvalid = (): AuthException =>
  new AuthException(
    'invitation_invalid',
    'The invitation is not valid',
    HttpStatus.BAD_REQUEST,
  );
