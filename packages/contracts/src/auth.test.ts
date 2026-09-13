import { describe, expect, it } from 'vitest';

import { sessionSchema } from './auth.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const SITE_ID = '33333333-3333-4333-8333-333333333333';

/** La sesión tal como la manda el servidor hoy. Cada test la deforma en un solo punto. */
function validSession() {
  return {
    userId: USER_ID,
    personId: PERSON_ID,
    role: 'inspector',
    siteScope: [SITE_ID],
    email: 'ada.reid@example.com',
    firstName: 'Ada',
    lastName: 'Reid',
  };
}

describe('sessionSchema', () => {
  it('acepta la sesión con identidad completa', () => {
    const parsed = sessionSchema.parse(validSession());

    expect(parsed.firstName).toBe('Ada');
    expect(parsed.email).toBe('ada.reid@example.com');
  });

  /**
   * ESTE es el test que protege al dispositivo sin red.
   *
   * El cliente guarda la sesión en Dexie y la revalida con este esquema al arrancar
   * offline. La fila que quedó guardada por la versión anterior no tiene `email`,
   * `firstName` ni `lastName`: si el esquema la rechazara, la aplicación no vería cuenta
   * y pediría login en una planta donde no hay señal para dárselo.
   */
  it('sigue aceptando una sesión guardada antes de que existiera la identidad', () => {
    const { email, firstName, lastName, ...cached } = validSession();
    void email;
    void firstName;
    void lastName;

    const parsed = sessionSchema.parse(cached);

    expect(parsed.userId).toBe(USER_ID);
    expect(parsed.firstName).toBeUndefined();
  });

  it('rechaza un nombre vacío en vez de mostrarlo en la barra', () => {
    expect(() => sessionSchema.parse({ ...validSession(), firstName: '   ' })).toThrow();
  });
});
