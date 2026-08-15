import { describe, expect, it } from 'vitest';

import { messageFor } from './presentation';

describe('el mensaje de la invitación', () => {
  /**
   * `invitation_invalid` cubre cuatro motivos y el servidor los unifica a propósito.
   * Esta pantalla no los separa: hacerlo la convertiría en un oráculo de qué tokens
   * existieron.
   */
  it('dice qué hacer sin decir por qué falló', () => {
    const message = messageFor('invitation_invalid');

    expect(message).toContain('issue a new one');
    expect(message).not.toMatch(/expired|revoked|already used|does not exist/i);
  });

  /** Un 400 de Zod o un 502 de un proxy traen texto escrito para un desarrollador. */
  it('no muestra crudo ningún otro código', () => {
    expect(messageFor('unreachable')).toBe(messageFor('some_unmapped_code'));
    expect(messageFor('unreachable')).toContain('Check your connection');
  });
});
