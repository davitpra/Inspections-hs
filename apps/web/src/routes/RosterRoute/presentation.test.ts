import { ROLE_LABELS, type Person, type PersonWithAccount } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  accountRoleLabel,
  canInvite,
  canReissueInvitation,
  canRemoveJhscAccess,
  emailCellLabel,
  inviteButtonLabel,
  jhscSeatAction,
  jhscSeatButtonLabel,
  jhscSeatButtonText,
  matchesSearch,
  personLabel,
  personName,
  reissueButtonLabel,
  removeButtonLabel,
  removeButtonText,
  roleCellClass,
  roleCellLabel,
  rosterCounts,
  showsAccountRole,
  sortRoster,
  importButtonText,
  importSummary,
  sortRejections,
} from './presentation';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const EMAIL = 'ada.reid@example.com';

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    site_id: SITE_A,
    employee_number: '10472',
    first_name: 'Ada',
    last_name: 'Reid',
    deactivated_at: null,
    ...overrides,
  };
}

/**
 * El email lo pone el helper y no cada caso: de las reglas de esta pantalla, la única que
 * mira esa columna es `emailCellLabel`. Repetirlo en las treinta filas de abajo escondería
 * los pocos casos donde el correo es el asunto.
 *
 * `jhsc_seat` va por el mismo camino, con default en `false`: es el estado de todas las
 * cuentas menos las de los casos que hablan del asiento, y ponerlo en cada fila diría que
 * importa donde no importa.
 */
function withAccount(
  overrides: Partial<Person> = {},
  account: Omit<NonNullable<PersonWithAccount['account']>, 'email' | 'jhsc_seat'> &
    { jhsc_seat?: boolean } | null = null,
): PersonWithAccount {
  return {
    ...person(overrides),
    account:
      account === null
        ? null
        : { ...account, email: EMAIL, jhsc_seat: account.jhsc_seat ?? false },
  };
}

describe('personName', () => {
  it('apellido primero, sin el número: en la tabla el número tiene su columna', () => {
    expect(personName(person())).toBe('Reid, Ada');
  });
});

describe('la presentación del reporte de importación', () => {
  const report = {
    import_id: null,
    source_filename: 'people.csv',
    rows_read: 4,
    rows_applied: 2,
    rows_rejected: 2,
    rejections: [
      { row_number: 5, employee_number: '4', reason: 'Bad status' },
      { row_number: 2, employee_number: null, reason: 'Missing employee number' },
    ],
  };

  it('resume los tres conteos en una línea', () => {
    expect(importSummary(report)).toBe('4 rows read, 2 applied, 2 rejected.');
  });

  it('ordena rechazos sin mutar el reporte', () => {
    expect(sortRejections(report.rejections).map((row) => row.row_number)).toEqual([2, 5]);
    expect(report.rejections.map((row) => row.row_number)).toEqual([5, 2]);
  });

  it.each([
    ['empty', 'Import roster'],
    ['ready', 'Import roster'],
    ['pending', 'Importing…'],
    ['success', 'Import roster'],
    ['error', 'Try again'],
  ] as const)('nombra el botón en %s', (state, label) => {
    expect(importButtonText(state)).toBe(label);
  });
});

describe('personLabel', () => {
  it('siempre lleva el número de empleado — el nombre no identifica', () => {
    expect(personLabel(person())).toBe('Reid, Ada (10472)');
  });

  it('distingue a dos homónimos', () => {
    const one = personLabel(person({ employee_number: '10472' }));
    const other = personLabel(person({ employee_number: '10473' }));

    expect(one).not.toBe(other);
  });
});

describe('inviteButtonLabel', () => {
  it('identifica a la persona, no solo "Invite"', () => {
    expect(inviteButtonLabel(person())).toBe('Invite Reid, Ada (10472) to JHSC');
  });
});

describe('matchesSearch', () => {
  it('encuentra por número de empleado, que es como busca quien lo tiene', () => {
    expect(matchesSearch(person(), '10472')).toBe(true);
    expect(matchesSearch(person(), '999')).toBe(false);
  });

  it('encuentra por apellido a medias y sin distinguir mayúsculas', () => {
    expect(matchesSearch(person(), 'rei')).toBe(true);
    expect(matchesSearch(person(), 'REID')).toBe(true);
  });

  it('encuentra por nombre', () => {
    expect(matchesSearch(person(), 'ada')).toBe(true);
  });

  it('ignora los acentos — "Álvarez" tipeado sin tilde tiene que encontrar', () => {
    const alvarez = person({ last_name: 'Álvarez' });

    expect(matchesSearch(alvarez, 'alvarez')).toBe(true);
    expect(matchesSearch(alvarez, 'álvarez')).toBe(true);
  });

  it('una búsqueda vacía no filtra nada', () => {
    expect(matchesSearch(person(), '')).toBe(true);
    expect(matchesSearch(person(), '   ')).toBe(true);
  });
});

describe('accountRoleLabel', () => {
  it('usa ROLE_LABELS de contracts, nunca el identificador crudo', () => {
    const label = accountRoleLabel({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: true,
      email: EMAIL,
      jhsc_seat: false,
    });

    expect(label).toBe('JHSC member');
    expect(label).not.toContain('jhsc_member');
  });

  it('marca "(invited)" cuando todavía no puede iniciar sesión', () => {
    const label = accountRoleLabel({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      email: EMAIL,
      jhsc_seat: false,
    });

    expect(label).toBe('JHSC member (invited)');
  });

});

describe('showsAccountRole', () => {
  it('muestra el rol de una cuenta activa', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(showsAccountRole(row)).toBe(true);
  });

  /**
   * Para el roster, una cuenta a la que se le quitó el acceso no existe: esa fila se
   * dibuja igual que la de quien nunca tuvo cuenta. Que la tuvo, y cuándo terminó, vive en
   * la cadena de auditoría.
   */
  it('no muestra ningún rol para una cuenta dada de baja', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(showsAccountRole(row)).toBe(false);
  });

  it('no muestra ningún rol para quien no tiene cuenta', () => {
    expect(showsAccountRole(withAccount())).toBe(false);
  });
});

describe('roleCellLabel', () => {
  it('dice el rol de la cuenta cuando la hay', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'supervisor', active: true, can_sign_in: true });

    expect(roleCellLabel(row)).toBe('Supervisor');
  });

  it('dice "Worker" para quien no tiene cuenta', () => {
    expect(roleCellLabel(withAccount())).toBe('Worker');
  });

  /**
   * La fila de quien perdió el acceso vuelve a decir "Worker", igual que la de quien nunca
   * tuvo cuenta: es la misma invariante que ya sostienen las afordancias, ahora también en
   * el texto de la celda.
   */
  it('vuelve a "Worker" cuando se le quitó el acceso a la cuenta', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(roleCellLabel(row)).toBe('Worker');
  });

  /**
   * "Worker" no es un rol asignable: no está en `ROLES`, así que nadie puede ser invitado
   * como worker ni el servidor lo aceptaría. Si alguien lo agrega al enum, este test cae y
   * la conversación pasa a ser sobre §4, que es donde tiene que darse.
   */
  it('"Worker" no es ninguno de los roles del dominio', () => {
    expect(Object.values(ROLE_LABELS)).not.toContain('Worker');
  });
});

describe('emailCellLabel', () => {
  it('dice el correo de la cuenta cuando la hay', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(emailCellLabel(row)).toBe(EMAIL);
  });

  it('no dice nada de quien no tiene cuenta — el roster del CSV no trae correos', () => {
    expect(emailCellLabel(withAccount())).toBe('');
  });

  /**
   * La misma condición que `roleCellLabel`: la cuenta a la que se le quitó el acceso no
   * existe para el roster, y las dos columnas tienen que contar la misma historia. Mostrar
   * el correo de una fila que dice "Worker" diría que esa dirección todavía tiene acceso.
   */
  it('no dice nada cuando se le quitó el acceso a la cuenta', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(emailCellLabel(row)).toBe('');
    expect(roleCellLabel(row)).toBe('Worker');
  });
});

describe('canInvite', () => {
  it('ofrece invitar a una persona activa sin cuenta', () => {
    expect(canInvite(withAccount())).toBe(true);
  });

  it('no ofrece invitar a quien ya tiene cuenta activa', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(canInvite(row)).toBe(false);
  });

  it('no ofrece invitar a quien tiene una invitación pendiente', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false });

    expect(canInvite(row)).toBe(false);
  });

  it('no ofrece invitar a una persona dada de baja', () => {
    const row = withAccount({ deactivated_at: '2026-01-01T00:00:00.000Z' });

    expect(canInvite(row)).toBe(false);
  });

  /**
   * El caso que este change agrega: a quien se le quitó el acceso se le ofrece invitar
   * igual que a quien nunca tuvo cuenta. Que del otro lado eso reviva la cuenta que ya
   * existía es cosa del servidor — `person_id` es único y no hay segunda cuenta posible.
   */
  it('ofrece invitar de nuevo a quien se le quitó el acceso', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(canInvite(row)).toBe(true);
  });

  it('no ofrece invitar si la cuenta dada de baja no era de jhsc_member', () => {
    for (const role of ['hs_coordinator', 'supervisor', 'management', 'external_auditor'] as const) {
      const row = withAccount({}, { id: ACCOUNT_ID, role, active: false, can_sign_in: false });

      expect(canInvite(row)).toBe(false);
    }
  });

  it('no ofrece invitar de nuevo a quien además dejó la planta', () => {
    const row = withAccount(
      { deactivated_at: '2026-01-01T00:00:00.000Z' },
      { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false },
    );

    expect(canInvite(row)).toBe(false);
  });
});

describe('canReissueInvitation', () => {
  it('ofrece reemitir cuando la cuenta está activa y todavía no puede entrar', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false });

    expect(canReissueInvitation(row)).toBe(true);
  });

  it('no ofrece reemitir a quien ya puede entrar', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(canReissueInvitation(row)).toBe(false);
  });

  it('no ofrece reemitir a una cuenta inactiva', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(canReissueInvitation(row)).toBe(false);
  });

  it('no ofrece reemitir a quien no tiene cuenta', () => {
    expect(canReissueInvitation(withAccount())).toBe(false);
  });
});

describe('reissueButtonLabel', () => {
  it('identifica a la persona, no solo "New link"', () => {
    expect(reissueButtonLabel(withAccount())).toBe('New invitation link for Reid, Ada (10472)');
  });
});

describe('canRemoveJhscAccess', () => {
  it('ofrece quitar el acceso a un miembro que ya entra', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(canRemoveJhscAccess(row)).toBe(true);
  });

  // El mismo acto para los dos: cancelar una invitación ES dar de baja la cuenta.
  it('ofrece quitar el acceso a una invitación que nadie aceptó', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false });

    expect(canRemoveJhscAccess(row)).toBe(true);
  });

  it('no ofrece quitar el acceso dos veces a la misma cuenta', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(canRemoveJhscAccess(row)).toBe(false);
  });

  it('no ofrece quitar el acceso a quien no tiene cuenta', () => {
    expect(canRemoveJhscAccess(withAccount())).toBe(false);
  });

  // El roster administra el acceso que el roster otorga, y eso es jhsc_member.
  it('no ofrece quitar el acceso a un rol que no es jhsc_member', () => {
    for (const role of ['hs_coordinator', 'supervisor', 'management', 'external_auditor'] as const) {
      const row = withAccount({}, { id: ACCOUNT_ID, role, active: true, can_sign_in: true });

      expect(canRemoveJhscAccess(row)).toBe(false);
    }
  });
});

describe('removeButtonLabel / removeButtonText', () => {
  it('habla de cancelar la invitación cuando la persona todavía no entró', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false });

    expect(removeButtonLabel(row)).toBe('Cancel the invitation of Reid, Ada (10472)');
    expect(removeButtonText(row)).toBe('Cancel invitation');
  });

  it('habla de quitar del JHSC cuando la persona ya entra', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(removeButtonLabel(row)).toBe('Remove Reid, Ada (10472) from JHSC');
    expect(removeButtonText(row)).toBe('Remove');
  });
});

/**
 * La invariante de la celda Actions: una fila ofrece UN acto, nunca dos. Es lo que el
 * spec pide ("the act that its state admits and no other"), y es exactamente lo que se
 * rompe cuando alguien agrega una acción nueva sin mirar las condiciones de las otras.
 */
describe('las afordancias de una fila son mutuamente excluyentes', () => {
  const rows: PersonWithAccount[] = [
    withAccount(),
    withAccount({ deactivated_at: '2026-01-01T00:00:00.000Z' }),
    withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false }),
    withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true }),
    withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false }),
    withAccount({}, { id: ACCOUNT_ID, role: 'supervisor', active: true, can_sign_in: true }),
  ];

  it('nunca ofrece invitar junto con quitar ni con reemitir', () => {
    for (const row of rows) {
      expect(canInvite(row) && canRemoveJhscAccess(row)).toBe(false);
      expect(canInvite(row) && canReissueInvitation(row)).toBe(false);
    }
  });

  /**
   * La fila de alguien a quien se le quitó el acceso queda idéntica a la de quien nunca
   * tuvo cuenta: sin rol que mostrar y con el botón de invitar. Es todo el objetivo de
   * este ajuste, y se prueba comparando las dos filas entre sí.
   */
  it('la fila sin acceso se comporta igual haya tenido cuenta o no', () => {
    const never = withAccount();
    const withdrawn = withAccount(
      {},
      { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false },
    );

    for (const affordance of [showsAccountRole, canInvite, canReissueInvitation, canRemoveJhscAccess]) {
      expect(affordance(withdrawn)).toBe(affordance(never));
    }
  });

  /**
   * La única pareja que SÍ convive, y a propósito: una invitación pendiente admite las
   * dos salidas —emitir otro link, o cancelarla—, y ofrecer solo una dejaría al
   * coordinador sin la que necesita.
   */
  it('ofrece reemitir y cancelar juntos, y solo sobre una invitación pendiente', () => {
    const pending = withAccount(
      {},
      { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false },
    );

    expect(canReissueInvitation(pending) && canRemoveJhscAccess(pending)).toBe(true);
  });
});

describe('sortRoster', () => {
  it('ordena por apellido y después por nombre', () => {
    const sorted = sortRoster([
      person({ id: 'a', last_name: 'Zeta', first_name: 'Ana' }),
      person({ id: 'b', last_name: 'Alvarez', first_name: 'Bruno' }),
      person({ id: 'c', last_name: 'Alvarez', first_name: 'Ana' }),
    ]);

    expect(sorted.map((row) => row.id)).toEqual(['c', 'b', 'a']);
  });

  it('desempata por número de empleado: dos homónimos no se intercambian entre renders', () => {
    const rows = [
      person({ id: 'second', employee_number: '10473' }),
      person({ id: 'first', employee_number: '10472' }),
    ];

    expect(sortRoster(rows).map((row) => row.id)).toEqual(['first', 'second']);
    expect(sortRoster(rows.slice().reverse()).map((row) => row.id)).toEqual(['first', 'second']);
  });

  it('no muta la lista que recibe', () => {
    const rows = [person({ id: 'z', last_name: 'Zeta' }), person({ id: 'a', last_name: 'Alfa' })];
    sortRoster(rows);

    expect(rows.map((row) => row.id)).toEqual(['z', 'a']);
  });
});

describe('roleCellClass', () => {
  it('quien ya entra se pinta como algo resuelto', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true });

    expect(roleCellClass(row)).toBe('status-pill status-pill--ready');
  });

  // Es lo mismo que la app pinta en ámbar en todas partes: algo que espera a alguien.
  it('la invitación sin aceptar se pinta como algo que espera', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false });

    expect(roleCellClass(row)).toBe('status-pill status-pill--not-ready');
  });

  // No tener acceso es la situación normal del roster, no una falta: gris apagado.
  it('quien no tiene cuenta se pinta apagado', () => {
    expect(roleCellClass(withAccount())).toBe('status-pill status-pill--not-opened');
  });

  it('la cuenta dada de baja se pinta como la de quien nunca tuvo una', () => {
    const row = withAccount({}, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false });

    expect(roleCellClass(row)).toBe('status-pill status-pill--not-opened');
  });
});

describe('rosterCounts', () => {
  it('cuenta a todos, a los que entran, y a los que tienen una invitación esperando', () => {
    const counts = rosterCounts([
      withAccount({ id: 'a' }, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: true }),
      withAccount({ id: 'b' }, { id: ACCOUNT_ID, role: 'jhsc_member', active: true, can_sign_in: false }),
      withAccount({ id: 'c' }),
    ]);

    expect(counts).toEqual({ total: 3, withAccess: 1, invited: 1 });
  });

  // Para el roster, esa persona no tiene cuenta: no entra y no está esperando nada.
  it('la cuenta dada de baja no cuenta ni como acceso ni como invitación', () => {
    const counts = rosterCounts([
      withAccount({ id: 'a' }, { id: ACCOUNT_ID, role: 'jhsc_member', active: false, can_sign_in: false }),
    ]);

    expect(counts).toEqual({ total: 1, withAccess: 0, invited: 0 });
  });

  it('un roster vacío cuenta cero y no rompe', () => {
    expect(rosterCounts([])).toEqual({ total: 0, withAccess: 0, invited: 0 });
  });
});

describe('jhscSeatAction — el asiento en el comité (coordinator-jhsc-seat)', () => {
  const coordinator = (jhsc_seat: boolean, active = true) =>
    withAccount({}, { id: ACCOUNT_ID, role: 'hs_coordinator', active, can_sign_in: true, jhsc_seat });

  it('ofrece sentarse a la coordinadora que no está en el comité', () => {
    expect(jhscSeatAction(coordinator(false))).toBe('grant');
  });

  it('ofrece levantarse a la coordinadora que sí está', () => {
    expect(jhscSeatAction(coordinator(true))).toBe('withdraw');
  });

  /**
   * Es el único rol al que el motor le deja el asiento: un `jhsc_member` ya está en el
   * comité por su rol, y a los otros tres §4 no los pone ahí. Ofrecer el botón sería
   * ofrecer algo que el servidor niega.
   */
  it('no ofrece nada sobre ningún otro rol', () => {
    for (const role of ['jhsc_member', 'supervisor', 'management', 'external_auditor'] as const) {
      const row = withAccount({}, { id: ACCOUNT_ID, role, active: true, can_sign_in: true });

      expect(jhscSeatAction(row)).toBeNull();
    }
  });

  it('no ofrece nada sobre una cuenta a la que se le quitó el acceso', () => {
    expect(jhscSeatAction(coordinator(false, false))).toBeNull();
  });

  it('no ofrece nada sobre una persona sin cuenta', () => {
    expect(jhscSeatAction(withAccount())).toBeNull();
  });

  /**
   * A diferencia de reemitir el link, el asiento NO pregunta por `can_sign_in`: una
   * coordinadora invitada que todavía no puso su contraseña puede quedar sentada desde ya.
   */
  it('ofrece el asiento aunque la cuenta todavía no pueda entrar', () => {
    const row = withAccount(
      {},
      { id: ACCOUNT_ID, role: 'hs_coordinator', active: true, can_sign_in: false, jhsc_seat: false },
    );

    expect(jhscSeatAction(row)).toBe('grant');
  });
});

describe('jhscSeatButtonText / jhscSeatButtonLabel', () => {
  it('el texto corto dice la dirección', () => {
    expect(jhscSeatButtonText('grant')).toBe('Join JHSC');
    expect(jhscSeatButtonText('withdraw')).toBe('Leave JHSC');
  });

  it('el nombre accesible identifica a la persona, como el de invitar', () => {
    const row = withAccount();

    expect(jhscSeatButtonLabel(row, 'grant')).toBe('Seat Reid, Ada (10472) on the JHSC');
    expect(jhscSeatButtonLabel(row, 'withdraw')).toBe(
      'Remove Reid, Ada (10472) from the JHSC seat',
    );
  });
});

describe('accountRoleLabel — el asiento en la celda Role', () => {
  const coordinator = (jhsc_seat: boolean, can_sign_in = true) => ({
    id: ACCOUNT_ID,
    role: 'hs_coordinator' as const,
    active: true,
    can_sign_in,
    email: EMAIL,
    jhsc_seat,
  });

  it('nombra el asiento pegado al rol: la columna se lee hacia abajo', () => {
    expect(accountRoleLabel(coordinator(true))).toBe('H&S coordinator · JHSC seat');
  });

  it('la coordinadora sin asiento se lee como siempre', () => {
    expect(accountRoleLabel(coordinator(false))).toBe('H&S coordinator');
  });

  it('el asiento no se come el "(invited)"', () => {
    expect(accountRoleLabel(coordinator(true, false))).toBe('H&S coordinator · JHSC seat (invited)');
  });

  // `jhsc_member` ya dice que está en el comité; un sufijo repetiría lo mismo.
  it('no le agrega nada a un JHSC member', () => {
    const label = accountRoleLabel({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: true,
      email: EMAIL,
      jhsc_seat: false,
    });

    expect(label).toBe(ROLE_LABELS.jhsc_member);
  });
});
