import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Role, SignInRequest, SignInResponse } from '@hs/contracts';

import { DbService } from '../db/db.service';
import { accountLocked, invalidCredentials } from './auth.errors';
import { CredentialService } from './credential.service';
import { SessionService } from './session.service';

interface AccountRow {
  id: string;
  role: Role;
  email: string;
  deactivated_at: Date | null;
  expires_at: Date | null;
}

/**
 * ADR-011 — El login, que es donde se juntan todas las reglas de este change.
 *
 * El orden de las verificaciones no es casual y es lo más importante de este archivo:
 * el bloqueo se mira ANTES de verificar la contraseña, porque si no el bloqueo no
 * bloquearía nada; y todo lo que no sea "entró" comparte una sola respuesta, porque
 * distinguirlas convertiría esta ruta en un verificador de qué direcciones tienen
 * cuenta en el sistema.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DbService,
    private readonly credentials: CredentialService,
    private readonly sessions: SessionService,
  ) {}

  async signIn(
    request: SignInRequest,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
  ): Promise<SignInResponse> {
    const account = await this.findAccount(request.email);

    // Email inexistente. No se escribe entrada de auditoría —no hay cuenta a la que
    // atribuirla ni sitio del que sacar una cadena, y una dirección tecleada mal en
    // una tabla append-only no se puede sacar después—, y la respuesta es la misma
    // que la de una contraseña incorrecta.
    if (!account) throw invalidCredentials();

    const credential = await this.credentials.find(account.id);

    // Cuenta desactivada, auditor vencido, o cuenta sin credencial: los tres se
    // responden igual que una contraseña incorrecta. El spec lo exige.
    if (
      !credential ||
      !credential.password ||
      account.deactivated_at ||
      (account.expires_at && account.expires_at.getTime() <= Date.now())
    ) {
      throw invalidCredentials();
    }

    if (credential.lockedUntil && credential.lockedUntil.getTime() > Date.now()) {
      // Este SÍ se distingue, y a propósito: el titular legítimo tiene que poder
      // entender por qué su contraseña correcta no entra, y quien esté probando ya
      // sabe que la cuenta existe — llegó al umbral.
      await this.record(account.id, 'auth.sign_in_failed', { reason: 'locked_out' });
      throw accountLocked();
    }

    const passwordValid = await this.credentials.verify(credential.password, request.password);

    if (!passwordValid) {
      const nowLocked = await this.credentials.registerFailure(credential.id, account.id);
      await this.record(account.id, 'auth.sign_in_failed', {
        reason: nowLocked ? 'wrong_password_locked_out' : 'wrong_password',
      });
      throw invalidCredentials();
    }

    await this.credentials.clearFailures(credential.id);

    // La contraseña es lo único que se verifica. El segundo factor salió del alcance
    // del MVP (change `remove-two-factor-for-mvp`), y con él la sesión de propósito
    // limitado: toda sesión que se emite acá es plena.
    const tokens = await this.sessions.issue(account.id, meta);
    const context = await this.sessions.resolve(tokens.accessToken);

    await this.record(account.id, 'auth.signed_in', {});

    return { session: await this.sessions.toContractSession(context), tokens };
  }

  async signOut(sessionId: string): Promise<void> {
    const { rows } = await this.db.unscopedPool.query<{ user_id: string }>(
      `SELECT user_id FROM app_session WHERE id = $1`,
      [sessionId],
    );

    await this.sessions.revokeSession(sessionId, 'signed_out');

    if (rows[0]) await this.record(rows[0].user_id, 'auth.signed_out', {});
  }

  private async findAccount(email: string): Promise<AccountRow | null> {
    const { rows } = await this.db.unscopedPool.query<AccountRow>(
      `SELECT id, role, email, deactivated_at, expires_at
         FROM app_user WHERE email = lower($1)`,
      [email],
    );

    return rows[0] ?? null;
  }

  /**
   * Los eventos de autenticación que no dejan fila propia. Van por la función de la
   * migración, que hace el fan-out a la cadena de CADA sitio del alcance de la cuenta
   * y rechaza cualquier `payload` que traiga un secreto.
   *
   * Necesita el alcance declarado porque `hs_account_audit_fanout` verifica que cada
   * sitio que toca esté adentro —falla con HS002 si no—, y en un login todavía no hay
   * sesión de la cual derivarlo. Se declara el alcance de la propia cuenta, que es
   * exactamente el conjunto de cadenas donde el hecho pertenece.
   */
  private async record(
    userId: string,
    kind: 'auth.signed_in' | 'auth.signed_out' | 'auth.sign_in_failed',
    body: Record<string, unknown>,
  ): Promise<void> {
    const { rows } = await this.db.unscopedPool.query<{ site_ids: string[] }>(
      `SELECT coalesce(array_agg(site_id ORDER BY site_id), ARRAY[]::uuid[]) AS site_ids
         FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );

    const siteIds = rows[0]?.site_ids ?? [];

    // Una cuenta sin alcance vigente no escribe ninguna entrada, y no es un hueco: no
    // alcanza ninguna planta, así que no hay cadena a la que el hecho pertenezca. Es
    // la misma consecuencia declarada que 0005 dejó escrita para el alta de cuenta.
    if (siteIds.length === 0) return;

    const payload = JSON.stringify({ account_id: userId, ...body });

    await this.db.withSiteScope({ siteIds, userId }, async (db) => {
      await db.execute(
        sql`SELECT hs_auth_event(${userId}::uuid, ${kind}::text, ${payload}::jsonb)`,
      );
    });
  }
}
