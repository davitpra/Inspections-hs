import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import { asAdministrator } from './account-scope';
import { AUTH_INSTANCE, type AuthInstance } from './better-auth';

/**
 * Design D8 y D14 — La credencial: el hash, y el bloqueo por intentos fallidos.
 *
 * El hash lo hace better-auth (scrypt, con sus parámetros). No se elige uno propio:
 * argon2id significaría una dependencia nativa más y una decisión de parámetros que
 * hay que sostener, y con este perfil —15-20 cuentas internas, sin registro público—
 * la diferencia no es lo que decide nada. Lo que decide es que la contraseña nunca
 * salga de esta tabla y que el bloqueo exista.
 *
 * El umbral y la duración viven acá y no en el esquema: son política, y la política
 * cambia sin migración.
 */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface CredentialRow {
  id: string;
  password: string | null;
  failedAttempts: number;
  lockedUntil: Date | null;
}

@Injectable()
export class CredentialService {
  constructor(
    private readonly db: DbService,
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
  ) {}

  async hasActive(userId: string): Promise<boolean> {
    const { rows } = await this.db.unscopedPool.query(
      `SELECT 1 FROM app_credential WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    return rows.length > 0;
  }

  async find(userId: string): Promise<CredentialRow | null> {
    const { rows } = await this.db.unscopedPool.query<{
      id: string;
      password: string | null;
      failed_attempts: number;
      locked_until: Date | null;
    }>(
      `SELECT id, password, failed_attempts, locked_until
         FROM app_credential WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    const row = rows[0];
    if (!row) return null;

    return {
      id: row.id,
      password: row.password,
      failedAttempts: row.failed_attempts,
      lockedUntil: row.locked_until,
    };
  }

  /**
   * `provider_id` es la constante `credential` de better-auth: es como distingue una
   * fila de contraseña de una de OAuth. `account_id` es, para ese proveedor, el id de
   * la cuenta.
   */
  async create(userId: string, password: string, client?: PoolClient): Promise<void> {
    const context = await this.auth.$context;
    const hash = await context.password.hash(password);

    const exec = client
      ? (sql: string, params: unknown[]) => client.query(sql, params)
      : (sql: string, params: unknown[]) => this.db.unscopedPool.query(sql, params);

    await exec(
      `INSERT INTO app_credential (id, account_id, provider_id, user_id, password)
       VALUES ($1, $2, 'credential', $3, $4)`,
      [randomUUID(), userId, userId, hash],
    );
  }

  async verify(hash: string, password: string): Promise<boolean> {
    const context = await this.auth.$context;

    return context.password.verify({ hash, password });
  }

  async revoke(userId: string, actorUserId: string): Promise<void> {
    await asAdministrator(this.db, actorUserId, (client) => revokeCredentials(client, userId));
  }

  /**
   * Un fallo más. Al llegar al umbral, bloquea — y el trigger lo audita, por lo que
   * necesita el alcance declarado de la cuenta.
   */
  async registerFailure(credentialId: string, userId: string): Promise<boolean> {
    const { rows } = await asAdministrator(this.db, userId, (client) =>
      client.query<{ locked_until: Date | null }>(
      `UPDATE app_credential
          SET failed_attempts = failed_attempts + 1,
              locked_until = CASE
                WHEN failed_attempts + 1 >= $2 THEN now() + ($3::text || ' milliseconds')::interval
                ELSE locked_until
              END,
              updated_at = now()
        WHERE id = $1
        RETURNING locked_until`,
        [credentialId, LOCKOUT_THRESHOLD, String(LOCKOUT_DURATION_MS)],
      ),
    );

    const lockedUntil = rows[0]?.locked_until ?? null;

    return lockedUntil !== null && lockedUntil.getTime() > Date.now();
  }

  /** Un login exitoso pone el contador en cero: el bloqueo es por RACHA, no acumulado. */
  async clearFailures(credentialId: string): Promise<void> {
    await this.db.unscopedPool.query(
      `UPDATE app_credential
          SET failed_attempts = 0, locked_until = NULL, updated_at = now()
        WHERE id = $1 AND (failed_attempts <> 0 OR locked_until IS NOT NULL)`,
      [credentialId],
    );
  }
}

/**
 * Revocar la credencial de una cuenta, dentro de la transacción que le pase el llamador.
 *
 * Exportada y no un método, por la misma razón que `revokePending`
 * (`invitation.service.ts`): quitarle el acceso a una cuenta
 * (`remove-jhsc-access-from-roster`) revoca su credencial, su invitación pendiente y pone
 * `deactivated_at` en un solo COMMIT, y una cuenta que quedara con la credencial viva
 * porque la revocación abrió su propia transacción y falló sería exactamente el estado a
 * medias que el acto único existe para evitar.
 *
 * Nunca DELETE (ADR-002): una credencial revocada es un hecho del registro.
 */
export async function revokeCredentials(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `UPDATE app_credential SET revoked_at = now()
      WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );
}
