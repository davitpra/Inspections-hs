import { describe, expect, it } from 'vitest';

import {
  AUDITOR_DEFAULT_DAYS,
  AUDITOR_MAX_DAYS,
  accountSchema,
  createAccountSchema,
  personOptionSchema,
  personSchema,
  roleSchema,
  rosterCsvRowSchema,
  rosterImportReportSchema,
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
    role: 'supervisor' as const,
    site_ids: [SITE_ID],
  };
}

describe('roleSchema', () => {
  it('acepta los cinco roles de §4', () => {
    for (const role of [
      'hs_coordinator',
      'jhsc_member',
      'supervisor',
      'management',
      'external_auditor',
    ]) {
      expect(roleSchema.safeParse(role).success).toBe(true);
    }
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
  it('acepta una cuenta interna sin vencimiento', () => {
    const result = accountSchema.safeParse({
      id: ACCOUNT_ID,
      person_id: PERSON_ID,
      email: 'ada.reid@example.com',
      role: 'supervisor',
      expires_at: null,
      records_from: null,
      records_to: null,
      deactivated_at: null,
      active: true,
      scope: [{ site_id: SITE_ID, granted_at: '2026-08-07T12:00:00Z', revoked_at: null }],
    });

    expect(result.success).toBe(true);
  });

  it('no acepta ninguna forma de credencial', () => {
    const result = accountSchema.safeParse({
      id: ACCOUNT_ID,
      person_id: PERSON_ID,
      email: 'ada.reid@example.com',
      role: 'supervisor',
      expires_at: null,
      records_from: null,
      records_to: null,
      deactivated_at: null,
      active: true,
      scope: [],
      password_hash: 'no',
    });

    expect(result.success).toBe(false);
  });
});

describe('createAccountSchema — ciclo de vida del auditor externo (§5 riesgo I)', () => {
  it('pone 30 días por default', () => {
    const result = createAccountSchema.safeParse(validAccountInput());

    expect(result.success).toBe(true);
    expect(result.success && result.data.expires_in_days).toBe(AUDITOR_DEFAULT_DAYS);
  });

  it('acepta 90 días', () => {
    const result = createAccountSchema.safeParse({
      ...validAccountInput(),
      role: 'external_auditor',
      expires_in_days: AUDITOR_MAX_DAYS,
      records_from: '2026-01-01',
      records_to: '2026-08-07',
    });

    expect(result.success).toBe(true);
  });

  it('rechaza 91 días', () => {
    const result = createAccountSchema.safeParse({
      ...validAccountInput(),
      role: 'external_auditor',
      expires_in_days: AUDITOR_MAX_DAYS + 1,
      records_from: '2026-01-01',
      records_to: '2026-08-07',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un auditor sin ventana de fechas', () => {
    const result = createAccountSchema.safeParse({
      ...validAccountInput(),
      role: 'external_auditor',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una ventana invertida', () => {
    const result = createAccountSchema.safeParse({
      ...validAccountInput(),
      role: 'external_auditor',
      records_from: '2026-08-07',
      records_to: '2026-01-01',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un alta sin ningún sitio en el alcance', () => {
    expect(
      createAccountSchema.safeParse({ ...validAccountInput(), site_ids: [] }).success,
    ).toBe(false);
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
