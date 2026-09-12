import type { PoolClient } from 'pg';
import type { CreatePersonRequest, Person, PersonWithAccount, RosterQuery } from '@hs/contracts';

/**
 * La consulta del roster, ahora con la cuenta de cada persona (proposal: "GET /people
 * devuelve, junto a cada persona, la cuenta que la referencia").
 *
 * `LEFT JOIN app_user`, y el aislamiento lo sigue dando la política sobre `person`
 * (ADR-002): ningún `WHERE site_id` de seguridad acá, el mismo criterio que ya explicaba
 * `roster.service.ts` antes de este archivo. `app_user` no lleva política, pero una
 * cuenta sin una `person` visible no aparece porque no hay fila de la que colgarla.
 * `hs_account_is_active` es la misma función que ya usa el motor (0005 §"activa o no"),
 * envuelta en `CASE` porque llamarla sobre una fila `NULL` de un LEFT JOIN sin cuenta
 * devuelve `NULL IS NULL = true` — activa por accidente para quien no tiene cuenta.
 */
export async function findRoster(
  client: PoolClient,
  query: RosterQuery,
): Promise<PersonWithAccount[]> {
  const { rows } = await client.query<RosterRow>(
    `SELECT p.id, p.site_id, p.employee_number, p.first_name, p.last_name, p.deactivated_at,
            u.id AS account_id, u.role AS account_role, u.email AS account_email,
            CASE WHEN u.id IS NULL THEN NULL ELSE hs_account_is_active(u) END AS account_active,
            EXISTS (
              SELECT 1 FROM app_credential c WHERE c.user_id = u.id AND c.revoked_at IS NULL
            ) AS can_sign_in
       FROM person p
       LEFT JOIN app_user u ON u.person_id = p.id
      WHERE p.site_id = $1
        AND ($2 = 'all'
             OR ($2 = 'active' AND p.deactivated_at IS NULL)
             OR ($2 = 'inactive' AND p.deactivated_at IS NOT NULL))
      ORDER BY p.last_name, p.first_name, p.employee_number`,
    [query.site_id, query.status],
  );

  return rows.map(toPersonWithAccount);
}

interface RosterRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  deactivated_at: Date | null;
  account_id: string | null;
  account_role: string | null;
  account_email: string | null;
  account_active: boolean | null;
  can_sign_in: boolean;
}

/**
 * El alta de UNA persona (`add-person-to-roster-by-hand`). Devuelve `null` cuando el
 * `employee_number` ya está tomado — nunca actualiza.
 *
 * **Por qué NO reusa `upsertPerson` de `apply-roster.ts` (design D2).** Aquel, al chocar
 * contra el `UNIQUE`, hace un `UPDATE`: aplicado acá convertiría "este número ya existe"
 * en "acabás de renombrar y mudar de planta a alguien que ni viste". Es exactamente el
 * write fila por fila que la spec sigue prohibiendo — son dos actos, y por eso dos
 * funciones.
 *
 * **Por qué `ON CONFLICT DO NOTHING` y no un `SELECT` previo.** Con RLS, ese `SELECT` no
 * ve la fila de otra planta: diría "libre", el `INSERT` reventaría contra el `UNIQUE`, y
 * el coordinador vería un 500 en el caso que justo hay que manejar con cuidado.
 * `ON CONFLICT` pregunta al índice, que no lleva RLS, y por eso contesta bien en los dos
 * casos con una sola sentencia — el mismo mecanismo que ya usa `upsertPerson`, por la
 * misma razón.
 */
export async function insertPerson(
  client: PoolClient,
  input: CreatePersonRequest,
): Promise<Person | null> {
  const { rows } = await client.query<PersonRow>(
    `INSERT INTO person (employee_number, first_name, last_name, site_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (employee_number) DO NOTHING
     RETURNING id, site_id, employee_number, first_name, last_name, deactivated_at`,
    [input.employee_number, input.first_name, input.last_name, input.site_id],
  );

  const [row] = rows;

  return row === undefined ? null : toPerson(row);
}

export type DeactivatePersonResult =
  | { status: 'deactivated'; person: Person }
  | { status: 'not_found' }
  | { status: 'has_active_account' }
  | { status: 'not_active' };

/**
 * Bloquea primero la persona y después la cuenta: crear o reactivar acceso no puede correr
 * en paralelo con esta baja. Una cuenta histórica inactiva permanece intacta.
 */
export async function deactivatePerson(
  client: PoolClient,
  personId: string,
): Promise<DeactivatePersonResult> {
  const locked = await client.query<{ deactivated_at: Date | null }>(
    `SELECT deactivated_at FROM person WHERE id = $1 FOR UPDATE`,
    [personId],
  );
  const [current] = locked.rows;

  if (current === undefined) return { status: 'not_found' };
  if (current.deactivated_at !== null) return { status: 'not_active' };

  const account = await client.query<{ id: string }>(
    `SELECT id FROM app_user WHERE person_id = $1 FOR UPDATE`,
    [personId],
  );
  const [linked] = account.rows;

  if (linked !== undefined) {
    const activity = await client.query<{ active: boolean }>(
      `SELECT hs_account_is_active(app_user.*) AS active FROM app_user WHERE id = $1`,
      [linked.id],
    );

    if (activity.rows[0]?.active) return { status: 'has_active_account' };
  }

  const { rows } = await client.query<PersonRow>(
    `UPDATE person
        SET deactivated_at = now()
      WHERE id = $1
      RETURNING id, site_id, employee_number, first_name, last_name, deactivated_at`,
    [personId],
  );

  return { status: 'deactivated', person: toPerson(rows[0]!) };
}

interface PersonRow extends Record<string, unknown> {
  id: string;
  site_id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
  deactivated_at: Date | null;
}

function toPerson(row: PersonRow): Person {
  return {
    id: row.id,
    site_id: row.site_id,
    employee_number: row.employee_number,
    first_name: row.first_name,
    last_name: row.last_name,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
  };
}

function toPersonWithAccount(row: RosterRow): PersonWithAccount {
  return {
    id: row.id,
    site_id: row.site_id,
    employee_number: row.employee_number,
    first_name: row.first_name,
    last_name: row.last_name,
    deactivated_at: row.deactivated_at?.toISOString() ?? null,
    account:
      row.account_id === null
        ? null
        : {
            id: row.account_id,
            role: row.account_role as NonNullable<PersonWithAccount['account']>['role'],
            active: row.account_active ?? false,
            can_sign_in: row.can_sign_in,
            // `app_user.email` es NOT NULL (0005): si hay `account_id`, hay email. El
            // `?? ''` es para el tipo del LEFT JOIN, no un caso real.
            email: row.account_email ?? '',
          },
  };
}
