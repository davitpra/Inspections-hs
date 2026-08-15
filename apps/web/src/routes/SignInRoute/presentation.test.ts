import { describe, expect, it } from 'vitest';

import { messageFor } from './presentation';

const FALLBACK = 'Something went wrong.';

describe('el mensaje del inicio de sesión', () => {
  /**
   * El servidor no distingue email inexistente de contraseña incorrecta, y esta pantalla
   * tampoco puede: distinguirlos la convertiría en un verificador de qué direcciones
   * tienen cuenta.
   */
  it('no separa el email inexistente de la contraseña incorrecta', () => {
    const message = messageFor('invalid_credentials', FALLBACK);

    expect(message).toBe('That email and password do not match an active account.');
    expect(message).not.toMatch(/no account|unknown email|wrong password/i);
  });

  it('la cuenta bloqueada dice qué hacer: esperar', () => {
    expect(messageFor('account_locked', FALLBACK)).toContain('Wait a few minutes');
  });

  /** Un 400 de Zod o un 502 de un proxy traen texto escrito para un desarrollador. */
  it('ningún otro código llega crudo a la pantalla', () => {
    expect(messageFor('ECONNREFUSED', FALLBACK)).toBe(FALLBACK);
  });
});
