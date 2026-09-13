import type { Session } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { displayName, initials } from './account';

const USER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';

function session(overrides: Partial<Session> = {}): Session {
  return {
    userId: USER,
    personId: PERSON,
    role: 'coordinator',
    siteScope: [SITE],
    email: 'ada.reid@example.com',
    firstName: 'Ada',
    lastName: 'Reid',
    ...overrides,
  };
}

describe('displayName', () => {
  it('usa el nombre completo cuando está', () => {
    expect(displayName(session())).toBe('Ada Reid');
  });

  it('cae al email cuando la sesión cacheada no trae nombre', () => {
    expect(displayName(session({ firstName: undefined, lastName: undefined }))).toBe(
      'ada.reid@example.com',
    );
  });

  it('cae al rol cuando no trae ni nombre ni email', () => {
    expect(
      displayName(session({ firstName: undefined, lastName: undefined, email: undefined })),
    ).toBe('Coordinator');
  });
});

describe('initials', () => {
  it('toma la primera letra del nombre y la del apellido', () => {
    expect(initials(session())).toBe('AR');
  });

  it('cae a una sola letra cuando falta el apellido', () => {
    expect(initials(session({ lastName: undefined }))).toBe('A');
  });

  it('cae a la primera letra del email cuando no hay nombre', () => {
    expect(initials(session({ firstName: undefined, lastName: undefined }))).toBe('A');
  });

  it('cae a la primera letra del rol cuando no hay ni nombre ni email', () => {
    expect(
      initials(session({ firstName: undefined, lastName: undefined, email: undefined })),
    ).toBe('C');
  });
});
