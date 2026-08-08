import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Los tokens que este change emite y no emite better-auth: el de invitación y el de
 * refresh.
 *
 * Los dos se guardan HASHEADOS. No es simetría por gusto: son los dos que sobreviven
 * días —72 horas la invitación, 14 el refresh— y por lo tanto los dos que una copia
 * de la base robada convertiría en acceso. El token de acceso no está hasheado porque
 * lo gestiona better-auth y vive 15 minutos; la compensación es que la tabla no
 * guarda ningún otro secreto.
 *
 * SHA-256 y no una función de derivación lenta: estos no son contraseñas. Un token de
 * 256 bits de entropía no se ataca por diccionario, y hacer lento el lookup de cada
 * refresh no compra nada. La contraseña sí usa scrypt, y eso lo hace better-auth.
 */

/** 32 bytes de entropía, en base64url para que viaje en una URL o en un header. */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Comparación en tiempo constante. Sobre un hash hexadecimal el riesgo real de una
 * comparación normal es bajo, pero el costo de hacerlo bien es una línea y el día que
 * alguien mueva esta función a un lugar más caliente nadie se va a acordar de
 * revisarlo.
 */
export function tokenMatches(token: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashToken(token), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  if (actual.length !== expected.length) return false;

  return timingSafeEqual(actual, expected);
}
