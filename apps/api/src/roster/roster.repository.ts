import type { PoolClient } from 'pg';
import type { PersonWithAccount, RosterQuery } from '@hs/contracts';

/**
 * La consulta del roster, ahora con la cuenta de cada persona (proposal: "GET /people
 * devuelve, junto a cada persona, la cuenta que la referencia").
 *
 * `LEFT JOIN app_user`, y el aislamiento lo sigue dando la política sobre `person`
 * (ADR-002): ningún `WHERE site_id` de seguridad acá, el mismo criterio que ya explicaba
 * `roster.service.ts` antes de este archivo. `app_user` no lleva política, pero una
 * cuenta sin una `person` visible no aparece porque no hay fila de la que colgarla.
 *
 * `jhsc_seat` es el asiento en el comité (0035) reducido a un booleano: la consola pregunta
 * quién está en el JHSC hoy, no desde cuándo.
 *
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
            ) AS can_sign_in,
            u.jhsc_seat_granted_at IS NOT NULL AS jhsc_seat
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
  jhsc_seat: boolean;
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
            // `IS NOT NULL` sobre la columna de una fila ausente ya devuelve `false`, así
            // que acá no hace falta el `CASE` que sí necesita `hs_account_is_active`.
            jhsc_seat: row.jhsc_seat,
          },
  };
}
