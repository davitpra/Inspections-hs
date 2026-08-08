import type { Pool } from 'pg';

import { withSiteScope } from '../../src/db/site-scope';
import { inScope, one } from './postgres';

/**
 * Helpers de identidad para los tests de integración.
 *
 * `person` lleva política RLS: todo lo que la toque declara el sitio, igual que lo
 * hará cualquier request. `app_user` y `user_site_scope` no la llevan, pero los
 * triggers de auditoría de cuenta y de alcance sí exigen que la planta alcanzada
 * esté declarada — si no, frenan con HS002. Por eso todo lo de acá corre bajo
 * alcance.
 */

/** Los ids que siembra `seeds/004_bootstrap_coordinator.sql`. */
export const SEEDED_COORDINATOR = {
  personId: '7e150000-0000-4000-8000-000000000001',
  accountId: 'acc00000-0000-4000-8000-000000000001',
} as const;

export interface AccountSpec {
  /** Id explícito, para que el test pueda declararlo como `app.user_id`. */
  id?: string;
  personId?: string;
  employeeNumber?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  role?: string;
  /** El sitio de la persona. El primero del alcance si no se da. */
  personSiteId?: string;
  /** El alcance vigente de la cuenta. */
  siteIds: readonly string[];
  expiresAt?: Date | null;
  recordsFrom?: string | null;
  recordsTo?: string | null;
}

export interface SeededAccount {
  accountId: string;
  personId: string;
  employeeNumber: string;
  email: string;
}

let counter = 0;

/**
 * Da de alta una persona, su cuenta y su alcance **en una sola transacción**.
 *
 * Que sea una sola no es comodidad: el trigger de alta de cuenta está diferido a
 * COMMIT justamente para encontrar el alcance ya otorgado. Si el alcance se
 * otorgara en otra transacción, el alta no escribiría ninguna entrada de auditoría.
 */
export async function createAccount(pool: Pool, spec: AccountSpec): Promise<SeededAccount> {
  counter += 1;

  const employeeNumber = spec.employeeNumber ?? `T${String(counter).padStart(5, '0')}`;
  const email = spec.email ?? `account.${counter}@example.com`;
  const personSiteId = spec.personSiteId ?? spec.siteIds[0];

  if (personSiteId === undefined) {
    throw new Error('createAccount necesita al menos un sitio para la persona.');
  }

  return withSiteScope(pool, { siteIds: spec.siteIds }, async (client) => {
    const person = await client.query<{ id: string }>(
      `INSERT INTO person (id, employee_number, first_name, last_name, site_id)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
       RETURNING id`,
      [
        spec.personId ?? null,
        employeeNumber,
        spec.firstName ?? 'Test',
        spec.lastName ?? `Person ${counter}`,
        personSiteId,
      ],
    );

    const personId = one(person.rows).id;

    const account = await client.query<{ id: string }>(
      `INSERT INTO app_user (id, person_id, email, role, expires_at, records_from, records_to)
       VALUES (coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        spec.id ?? null,
        personId,
        email,
        spec.role ?? 'hs_coordinator',
        spec.expiresAt ?? null,
        spec.recordsFrom ?? null,
        spec.recordsTo ?? null,
      ],
    );

    const accountId = one(account.rows).id;

    for (const siteId of spec.siteIds) {
      await client.query('INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
        accountId,
        siteId,
      ]);
    }

    return { accountId, personId, employeeNumber, email };
  });
}

/** Da de alta una persona del roster, sin cuenta — que es el caso normal. */
export async function createPerson(
  pool: Pool,
  siteId: string,
  overrides: { employeeNumber?: string; firstName?: string; lastName?: string } = {},
): Promise<string> {
  counter += 1;

  const rows = await inScope<{ id: string }>(
    pool,
    [siteId],
    `INSERT INTO person (employee_number, first_name, last_name, site_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      overrides.employeeNumber ?? `R${String(counter).padStart(5, '0')}`,
      overrides.firstName ?? 'Roster',
      overrides.lastName ?? `Person ${counter}`,
      siteId,
    ],
  );

  return one(rows).id;
}

export interface PersonRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  deactivated_at: Date | null;
}

/** Una persona por id, dentro del alcance dado. */
export async function personById(
  pool: Pool,
  siteIds: readonly string[],
  id: string,
): Promise<PersonRow> {
  const rows = await inScope<PersonRow>(
    pool,
    siteIds,
    `SELECT id, site_id, employee_number, first_name, last_name, deactivated_at
       FROM person WHERE id = $1`,
    [id],
  );

  return one(rows);
}

/**
 * El selector de sujeto: las personas activas de los sitios del alcance, por
 * apellido. Es la consulta que va a hacer la pantalla, escrita una sola vez.
 */
export async function selectablePeople(
  pool: Pool,
  siteIds: readonly string[],
): Promise<PersonRow[]> {
  return inScope<PersonRow>(
    pool,
    siteIds,
    `SELECT id, site_id, employee_number, first_name, last_name, deactivated_at
       FROM person
      WHERE deactivated_at IS NULL
      ORDER BY last_name, first_name`,
  );
}

/** El alcance vigente de una cuenta. */
export async function effectiveScope(pool: Pool, accountId: string): Promise<string[]> {
  const rows = await inScope<{ site_id: string }>(
    pool,
    [],
    'SELECT site_id FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL ORDER BY site_id',
    [accountId],
  );

  return rows.map((row) => row.site_id);
}
