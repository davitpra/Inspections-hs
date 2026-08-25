import type { PoolClient } from 'pg';

/**
 * El orden de INSERT del alta de una cuenta, y NADA MÁS: sin chequeo de rol, sin
 * comprobación de conflicto, sin decorador de NestJS. Design D6 — dos implementaciones
 * del mismo orden es exactamente cómo una de las dos deja de escribir auditoría sin que
 * nadie se entere, así que el `INSERT` vive una sola vez.
 *
 * Lo comparten `AccountService.create()` (`POST /accounts`) y `scripts/create-account.mjs`,
 * que lo importa desde `dist/` porque es un script `.mjs` sin runtime de TypeScript —no hay
 * `ts-node` ni `tsx` en este repo— y no puede importar `.ts` directamente. Por eso ESTE
 * archivo, y no `account.service.ts` entero: nada acá depende de `DbService` ni de
 * inyección de dependencias, así que compilarlo con `pnpm --filter api build` y cargarlo
 * como CommonJS desde un script plano es seguro. El chequeo de rol, el de conflicto y los
 * mensajes de error SÍ difieren entre las dos puntas —una responde HTTP, la otra imprime en
 * una terminal— y por eso se quedan donde están: lo peligroso de duplicar es el orden de
 * escritura, no el texto de un error.
 */
export interface AccountInsert {
  personId: string;
  email: string;
  role: string;
  expiresAt: Date | null;
  recordsFrom: string | null;
  recordsTo: string | null;
  siteIds: readonly string[];
}

/** El alta: `app_user` y, por cada sitio del alcance pedido, su `user_site_scope`. */
export async function insertAccount(client: PoolClient, input: AccountInsert): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO app_user (person_id, email, role, expires_at, records_from, records_to)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [input.personId, input.email, input.role, input.expiresAt, input.recordsFrom, input.recordsTo],
  );

  const accountId = rows[0]!.id;

  for (const siteId of input.siteIds) {
    await client.query('INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)', [
      accountId,
      siteId,
    ]);
  }

  return accountId;
}

export interface AccountDetailRow {
  id: string;
  role: string;
  active: boolean;
  can_sign_in: boolean;
  email: string;
  jhsc_seat: boolean;
}

/**
 * `GET /accounts/:id` (`reissue-invitation-link-from-roster`, design D6): una cuenta, no
 * el roster. `JOIN person` y no un `WHERE site_id` de seguridad: `app_user` no lleva
 * política, así que el aislamiento lo da la política de `person` de la que se parte —
 * mismo criterio que `findRoster` documenta. Misma expresión de `active` y `can_sign_in`
 * que `roster.repository.ts`.
 */
export async function findAccountDetail(
  client: PoolClient,
  accountId: string,
): Promise<AccountDetailRow | null> {
  const { rows } = await client.query<AccountDetailRow>(
    `SELECT u.id, u.role, u.email, hs_account_is_active(u) AS active,
            EXISTS (
              SELECT 1 FROM app_credential c WHERE c.user_id = u.id AND c.revoked_at IS NULL
            ) AS can_sign_in,
            u.jhsc_seat_granted_at IS NOT NULL AS jhsc_seat
       FROM app_user u
       JOIN person p ON p.id = u.person_id
      WHERE u.id = $1`,
    [accountId],
  );

  return rows[0] ?? null;
}
