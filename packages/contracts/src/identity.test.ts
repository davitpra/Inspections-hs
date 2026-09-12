import { describe, expect, it } from 'vitest';

import {
  ROLES,
  accountDetailSchema,
  accountSchema,
  createAccountRequestSchema,
  createAccountResponseSchema,
  createAccountSchema,
  createPersonRequestSchema,
  isAdministrator,
  personAccountSchema,
  personOptionSchema,
  personSchema,
  personWithAccountSchema,
  roleSchema,
  rosterCsvRowSchema,
  rosterImportReportSchema,
  rosterQuerySchema,
  updateAccountRequestSchema,
} from './identity.js';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';
const SITE_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_ID = '33333333-3333-4333-8333-333333333333';

/** Una persona válida. Cada test la deforma en un solo punto. */
function validPerson() {
  return {
    id: PERSON_ID,
    site_id: SITE_ID,
    employee_number: '10472',
    first_name: 'Ada',
    last_name: 'Reid',
    deactivated_at: null,
  };
}

/** Un alta de cuenta válida de un rol interno. */
function validAccountInput() {
  return {
    person_id: PERSON_ID,
    email: 'ada.reid@example.com',
    role: 'jhsc_member' as const,
    site_ids: [SITE_ID],
  };
}

describe('roleSchema', () => {
  it('acepta los tres roles vigentes', () => {
    for (const role of ['hs_coordinator', 'jhsc_member', 'management']) {
      expect(roleSchema.safeParse(role).success).toBe(true);
    }
  });

  it('rechaza los roles retirados', () => {
    expect(roleSchema.safeParse('supervisor').success).toBe(false);
    expect(roleSchema.safeParse('external_auditor').success).toBe(false);
  });

  it('rechaza "inspector" — no es un rol, es un campo de la inspección', () => {
    expect(roleSchema.safeParse('inspector').success).toBe(false);
  });
});

describe('personSchema', () => {
  it('acepta una persona del roster', () => {
    expect(personSchema.safeParse(validPerson()).success).toBe(true);
  });

  it('rechaza un número de empleado con espacios', () => {
    expect(
      personSchema.safeParse({ ...validPerson(), employee_number: '104 72' }).success,
    ).toBe(false);
  });

  it('rechaza un nombre vacío', () => {
    expect(personSchema.safeParse({ ...validPerson(), first_name: '   ' }).success).toBe(false);
  });

  it('acepta dos personas con el mismo nombre — el nombre no identifica', () => {
    const one = personSchema.safeParse(validPerson());
    const other = personSchema.safeParse({
      ...validPerson(),
      id: '44444444-4444-4444-8444-444444444444',
      employee_number: '10473',
    });

    expect(one.success && other.success).toBe(true);
  });
});

describe('rosterQuerySchema', () => {
  it('mira las activas si nadie dice lo contrario', () => {
    const result = rosterQuerySchema.safeParse({ site_id: SITE_ID });

    expect(result.success && result.data.status).toBe('active');
  });

  it('deja pedir explícitamente a las dadas de baja', () => {
    expect(rosterQuerySchema.safeParse({ site_id: SITE_ID, status: 'inactive' }).success).toBe(
      true,
    );
    expect(rosterQuerySchema.safeParse({ site_id: SITE_ID, status: 'all' }).success).toBe(true);
  });

  it('rechaza un estado que no existe', () => {
    expect(rosterQuerySchema.safeParse({ site_id: SITE_ID, status: 'retired' }).success).toBe(
      false,
    );
  });

  it('exige la planta — sin ella la respuesta no estaría acotada', () => {
    expect(rosterQuerySchema.safeParse({}).success).toBe(false);
    expect(rosterQuerySchema.safeParse({ site_id: 'st-thomas' }).success).toBe(false);
  });
});

describe('createPersonRequestSchema — el alta a mano (add-person-to-roster-by-hand)', () => {
  /** Un alta válida. Cada test la deforma en un solo punto. */
  function validCreatePersonInput() {
    return {
      site_id: SITE_ID,
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
    };
  }

  it('acepta un alta válida', () => {
    expect(createPersonRequestSchema.safeParse(validCreatePersonInput()).success).toBe(true);
  });

  it('recorta los espacios de los nombres', () => {
    const result = createPersonRequestSchema.safeParse({
      ...validCreatePersonInput(),
      first_name: '  Ada  ',
      last_name: '  Reid  ',
    });

    expect(result.success && result.data.first_name).toBe('Ada');
    expect(result.success && result.data.last_name).toBe('Reid');
  });

  it('rechaza un employee_number que no cumple EMPLOYEE_NUMBER_PATTERN', () => {
    expect(
      createPersonRequestSchema.safeParse({
        ...validCreatePersonInput(),
        employee_number: 'has spaces',
      }).success,
    ).toBe(false);
  });

  it('rechaza una clave de más — no hay status ni site_code en un alta a mano', () => {
    expect(
      createPersonRequestSchema.safeParse({ ...validCreatePersonInput(), status: 'active' })
        .success,
    ).toBe(false);
  });
});

describe('personOptionSchema', () => {
  it('lleva el número de empleado, que es lo que distingue a dos homónimos', () => {
    const result = personOptionSchema.safeParse({
      id: PERSON_ID,
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
    });

    expect(result.success).toBe(true);
  });

  it('no expone nada del perfil — §4: se elige sin poder verlo', () => {
    const result = personOptionSchema.safeParse({
      id: PERSON_ID,
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
      site_id: SITE_ID,
    });

    expect(result.success).toBe(false);
  });
});

describe('accountSchema', () => {
  it('acepta una cuenta vigente', () => {
    const result = accountSchema.safeParse({
      id: ACCOUNT_ID,
      person_id: PERSON_ID,
      email: 'ada.reid@example.com',
      role: 'management',
      deactivated_at: null,
      active: true,
      jhsc_seat: false,
      scope: [{ site_id: SITE_ID, granted_at: '2026-08-07T12:00:00Z', revoked_at: null }],
    });

    expect(result.success).toBe(true);
  });

  it('no acepta ninguna forma de credencial', () => {
    const result = accountSchema.safeParse({
      id: ACCOUNT_ID,
      person_id: PERSON_ID,
      email: 'ada.reid@example.com',
      role: 'management',
      deactivated_at: null,
      active: true,
      jhsc_seat: false,
      scope: [],
      password_hash: 'no',
    });

    expect(result.success).toBe(false);
  });
});

describe('createAccountSchema', () => {
  it('acepta el alta de un rol vigente', () => {
    const result = createAccountSchema.safeParse(validAccountInput());

    expect(result.success).toBe(true);
  });

  it('rechaza el ciclo de vida retirado del auditor', () => {
    const result = createAccountSchema.safeParse({
      ...validAccountInput(),
      expires_in_days: 30,
      records_from: '2026-08-07',
      records_to: '2026-09-07',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un alta sin ningún sitio en el alcance', () => {
    expect(
      createAccountSchema.safeParse({ ...validAccountInput(), site_ids: [] }).success,
    ).toBe(false);
  });
});

describe('personWithAccountSchema', () => {
  it('acepta una persona sin cuenta', () => {
    const result = personWithAccountSchema.safeParse({ ...validPerson(), account: null });

    expect(result.success).toBe(true);
  });

  it('acepta una persona con cuenta', () => {
    const result = personWithAccountSchema.safeParse({
      ...validPerson(),
      account: {
        id: ACCOUNT_ID,
        role: 'jhsc_member',
        active: true,
        can_sign_in: false,
        jhsc_seat: false,
        email: 'ada.reid@example.com',
      },
    });

    expect(result.success).toBe(true);
  });

  it('rechaza una cuenta sin email — la fila del roster dice a qué dirección se invitó', () => {
    const result = personAccountSchema.safeParse({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      jhsc_seat: false,
    });

    expect(result.success).toBe(false);
  });

  it('sigue rechazando lo que NO es el mínimo del design D2: alcance, credencial, token', () => {
    const result = personAccountSchema.safeParse({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      jhsc_seat: false,
      email: 'ada.reid@example.com',
      scope: [],
    });

    expect(result.success).toBe(false);
  });
});

describe('createAccountRequestSchema — el alta desde el roster (design D4)', () => {
  it('acepta el mismo alta que el comando, con invite por default en false', () => {
    const result = createAccountRequestSchema.safeParse(validAccountInput());

    expect(result.success).toBe(true);
    expect(result.success && result.data.invite).toBe(false);
  });

  it('acepta invite: true', () => {
    const result = createAccountRequestSchema.safeParse({ ...validAccountInput(), invite: true });

    expect(result.success).toBe(true);
  });

  it('rechaza un rol retirado', () => {
    const result = createAccountRequestSchema.safeParse({
      ...validAccountInput(),
      role: 'external_auditor',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza site_ids vacío', () => {
    const result = createAccountRequestSchema.safeParse({
      ...validAccountInput(),
      site_ids: [],
    });

    expect(result.success).toBe(false);
  });
});

describe('createAccountResponseSchema', () => {
  it('el token es opcional — solo está cuando se invitó', () => {
    const result = createAccountResponseSchema.safeParse({
      account: {
        id: ACCOUNT_ID,
        role: 'jhsc_member',
        active: true,
        can_sign_in: false,
        jhsc_seat: false,
        email: 'ada.reid@example.com',
      },
    });

    expect(result.success).toBe(true);
  });

  it('acepta la invitación cuando se pidió', () => {
    const result = createAccountResponseSchema.safeParse({
      account: {
        id: ACCOUNT_ID,
        role: 'jhsc_member',
        active: true,
        can_sign_in: false,
        jhsc_seat: false,
        email: 'ada.reid@example.com',
      },
      invitation: { token: 'a-one-time-token', expiresAt: '2026-08-17T12:00:00Z' },
    });

    expect(result.success).toBe(true);
  });
});

describe('rosterCsvRowSchema', () => {
  it('acepta una fila del CSV', () => {
    const result = rosterCsvRowSchema.safeParse({
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
      site_code: 'st-thomas',
      status: 'active',
    });

    expect(result.success).toBe(true);
  });

  it('rechaza un status fuera de active/inactive', () => {
    const result = rosterCsvRowSchema.safeParse({
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
      site_code: 'st-thomas',
      status: 'terminated',
    });

    expect(result.success).toBe(false);
  });

  it('exige status: la ausencia de una fila no da de baja, el estado es explícito', () => {
    const result = rosterCsvRowSchema.safeParse({
      employee_number: '10472',
      first_name: 'Ada',
      last_name: 'Reid',
      site_code: 'st-thomas',
    });

    expect(result.success).toBe(false);
  });
});

describe('rosterImportReportSchema', () => {
  it('acepta un reporte con rechazos', () => {
    const result = rosterImportReportSchema.safeParse({
      import_id: ACCOUNT_ID,
      source_filename: 'roster-2026-08.csv',
      rows_read: 200,
      rows_applied: 197,
      rows_rejected: 3,
      rejections: [
        { row_number: 3, employee_number: null, reason: 'employee_number is missing' },
        { row_number: 48, employee_number: '10472', reason: 'unknown site_code "st-tomas"' },
        { row_number: 91, employee_number: '10500', reason: 'duplicate employee_number in file' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('acepta un reporte limpio, sin rechazos', () => {
    const result = rosterImportReportSchema.safeParse({
      import_id: ACCOUNT_ID,
      source_filename: 'roster-2026-08.csv',
      rows_read: 200,
      rows_applied: 200,
      rows_rejected: 0,
      rejections: [],
    });

    expect(result.success).toBe(true);
  });
});

describe('accountDetailSchema — la lectura de una cuenta (reissue-invitation-link-from-roster, design D6)', () => {
  it('acepta la cuenta con su email', () => {
    const result = accountDetailSchema.safeParse({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      jhsc_seat: false,
      email: 'ada.reid@example.com',
    });

    expect(result.success).toBe(true);
  });

  it('rechaza un campo que no es del roster reducido ni del email', () => {
    const result = accountDetailSchema.safeParse({
      id: ACCOUNT_ID,
      role: 'jhsc_member',
      active: true,
      can_sign_in: false,
      jhsc_seat: false,
      email: 'ada.reid@example.com',
      scope: [],
    });

    expect(result.success).toBe(false);
  });
});

describe('updateAccountRequestSchema — el pedido de PATCH /accounts/:id (design D5)', () => {
  it('rechaza el objeto vacío: un update tiene que cambiar algo', () => {
    const result = updateAccountRequestSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('acepta reemitir sin corregir el email', () => {
    const result = updateAccountRequestSchema.safeParse({ invite: true });

    expect(result.success).toBe(true);
  });

  it('acepta corregir el email sin reemitir', () => {
    const result = updateAccountRequestSchema.safeParse({ email: 'ada.reid@example.com' });

    expect(result.success).toBe(true);
  });

  it('no expone un role libre', () => {
    const result = updateAccountRequestSchema.safeParse({ role: 'management' });

    expect(result.success).toBe(false);
  });

  it('acepta únicamente la promoción literal a coordinador', () => {
    expect(
      updateAccountRequestSchema.safeParse({ promote_to: 'hs_coordinator' }).success,
    ).toBe(true);
    expect(updateAccountRequestSchema.safeParse({ promote_to: 'management' }).success).toBe(false);
  });

  it('rechaza combinar la promoción con otro acto', () => {
    for (const other of [
      { deactivated: true as const },
      { email: 'ada.reid@example.com' },
      { invite: true },
      { jhsc_seat: true },
    ]) {
      expect(
        updateAccountRequestSchema.safeParse({ promote_to: 'hs_coordinator', ...other }).success,
      ).toBe(false);
    }
  });

  it('acepta dar de baja el acceso, solo', () => {
    const result = updateAccountRequestSchema.safeParse({ deactivated: true });

    expect(result.success).toBe(true);
  });

  /**
   * Por esta ruta una cuenta solo se da de baja. Devolverle el acceso a alguien es
   * invitarlo —`POST /accounts`, que revive la cuenta que ya tenía—, y un `false` acá sería
   * un segundo camino a la misma intención.
   */
  it('rechaza deactivated: false — devolver el acceso no se pide por acá', () => {
    const result = updateAccountRequestSchema.safeParse({ deactivated: false, invite: true });

    expect(result.success).toBe(false);
  });

  // Un pedido que se contradice. Ver el comentario del esquema: aceptarlo obligaría al
  // servicio a elegir cuál de los dos actos gana.
  it('rechaza dar de baja y emitir un link a la vez', () => {
    const result = updateAccountRequestSchema.safeParse({ deactivated: true, invite: true });

    expect(result.success).toBe(false);
  });

  it('rechaza dar de baja y corregir el correo a la vez', () => {
    const result = updateAccountRequestSchema.safeParse({
      deactivated: true,
      email: 'ada.reid@example.com',
    });

    expect(result.success).toBe(false);
  });

  /**
   * El asiento en el JHSC va en los DOS sentidos, y ahí está la diferencia con
   * `deactivated`: sentarse y levantarse son el mismo acto reversible sobre la misma
   * columna, no dos intenciones con rutas distintas.
   */
  it('acepta sentarse en el JHSC, solo', () => {
    expect(updateAccountRequestSchema.safeParse({ jhsc_seat: true }).success).toBe(true);
  });

  it('acepta levantarse del JHSC, solo', () => {
    expect(updateAccountRequestSchema.safeParse({ jhsc_seat: false }).success).toBe(true);
  });

  it('rechaza el asiento combinado con la baja, el correo o el link', () => {
    for (const other of [
      { deactivated: true as const },
      { email: 'ada.reid@example.com' },
      { invite: true },
    ]) {
      const result = updateAccountRequestSchema.safeParse({ jhsc_seat: true, ...other });

      expect(result.success).toBe(false);
    }
  });
});

describe('isAdministrator', () => {
  it('admite coordinador y gerencia, no al miembro JHSC', () => {
    expect(ROLES.filter(isAdministrator)).toEqual(['hs_coordinator', 'management']);
    expect(isAdministrator('jhsc_member')).toBe(false);
  });
});
