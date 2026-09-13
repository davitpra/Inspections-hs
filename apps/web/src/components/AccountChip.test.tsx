import type { Session } from '@hs/contracts';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { AccountChip } from './AccountChip';

const USER = '11111111-1111-4111-8111-111111111111';
const PERSON = '22222222-2222-4222-8222-222222222222';
const SITE = '33333333-3333-4333-8333-333333333333';

/** La sesión completa. Cada test le saca exactamente una cosa. */
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

afterEach(() => {
  cleanup();
});

describe('AccountChip', () => {
  it('dice el nombre y el rol de quien está adentro', () => {
    render(<AccountChip account={session()} />);

    expect(screen.getByText('Ada Reid')).toBeTruthy();
    expect(screen.getByText('Coordinator')).toBeTruthy();
  });

  /**
   * El rol se muestra con el término de §4 y NUNCA con el identificador: "Inspector",
   * no `inspector` y no "Inspector", que es lo que alguien escribiría a mano.
   */
  it('escribe el rol con el vocabulario del dominio, no con el identificador', () => {
    render(<AccountChip account={session({ role: 'inspector' })} />);

    expect(screen.getByText('Inspector')).toBeTruthy();
    expect(screen.queryByText('inspector')).toBeNull();
  });

  /**
   * Los dos respaldos existen por la sesión que quedó cacheada antes de que el servidor
   * mandara identidad: un dispositivo sin red la revalida y entra sin nombre. El chip
   * tiene que decir algo útil igual — quedarse en blanco sería peor que no tenerlo.
   */
  it('cae al email cuando la sesión cacheada no trae nombre', () => {
    render(
      <AccountChip account={session({ firstName: undefined, lastName: undefined })} />,
    );

    expect(screen.getByText('ada.reid@example.com')).toBeTruthy();
    expect(screen.getByText('Coordinator')).toBeTruthy();
  });

  it('cae al rol cuando no trae ni nombre ni email, y no lo escribe dos veces', () => {
    render(
      <AccountChip
        account={session({ firstName: undefined, lastName: undefined, email: undefined })}
      />,
    );

    expect(screen.getAllByText('Coordinator')).toHaveLength(1);
  });

  it('deja el email a mano aunque el nombre ocupe la línea', () => {
    render(<AccountChip account={session()} />);

    expect(screen.getByText('Ada Reid').getAttribute('title')).toBe('ada.reid@example.com');
  });
});
