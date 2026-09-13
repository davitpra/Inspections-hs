import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  INVITATION_DEFAULT_HOURS,
  isAdministrator,
  type IssueInvitationResponse,
  type Role,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import { asAdministrator } from './account-scope';
import { forbidden, invitationInvalid } from './auth.errors';
import { CredentialService } from './credential.service';
import { generateToken, hashToken } from './tokens';

/**
 * ADR-011 — El alta es por invitación del coordinador. Sin auto-registro.
 *
 * Esta es la única puerta por la que una cuenta pasa de "identidad completa" a "puede
 * iniciar sesión", y por eso concentra tres reglas que en otros sistemas están
 * repartidas: quién puede abrirla, cuánto queda abierta, y que se cierra sola después
 * de usarse una vez.
 *
 * Es también el camino del REINICIO de contraseña, y no por ahorro: sin correo
 * transaccional (design D9) no hay a dónde mandar un link, y ADR-011 ya deja la
 * recuperación por autoservicio fuera de alcance. Revocar la credencial y emitir una
 * invitación nueva es el mismo acto que el alta, con el mismo rastro en la cadena.
 */
@Injectable()
export class InvitationService {
  constructor(
    private readonly db: DbService,
    private readonly credentials: CredentialService,
  ) {}

  /**
   * Emite. El token en claro sale de acá una sola vez y nunca más: del otro lado solo
   * queda su hash. Si el coordinador lo pierde, revoca y emite otro.
   */
  async issue(
    actor: { userId: string; role: Role },
    targetUserId: string,
    expiresInHours = INVITATION_DEFAULT_HOURS,
  ): Promise<IssueInvitationResponse> {
    if (!isAdministrator(actor.role)) {
      throw forbidden('Only the coordinator can invite an account');
    }

    const { rows: target } = await this.db.unscopedPool.query<{ id: string }>(
      `SELECT id FROM app_user WHERE id = $1 AND deactivated_at IS NULL`,
      [targetUserId],
    );

    // No existe, o es una `person` sin cuenta: crear la cuenta es un acto aparte y
    // anterior, y confundirlos haría que invitar creara identidades.
    if (!target[0]) throw invitationInvalid();

    if (await this.credentials.hasActive(targetUserId)) {
      throw invitationInvalid();
    }

    // Bajo el alcance del actor: el trigger de auditoría escribe en la cadena de cada
    // planta que la cuenta invitada alcanza, y frena con HS002 si alguna está fuera.
    // Eso hace que "el coordinador no puede administrar a alguien de una planta que no
    // tiene" sea una regla del motor y no un `if` que se puede olvidar.
    return asAdministrator(this.db, actor.userId, async (client) => {
      await revokePending(client, targetUserId);

      return this.writeInvitation(client, actor.userId, targetUserId, expiresInHours);
    });
  }

  /**
   * La escritura de la invitación, sola: el `INSERT`, dentro de la transacción que le
   * pase el llamador en vez de abrir la suya (design D4, tasks 3.1/3.2).
   *
   * `POST /accounts` (`account.service.ts`) la llama desde DENTRO de su propia
   * `asAdministrator`, así que el alta y la invitación comparten `COMMIT`: no existe el
   * estado intermedio "cuenta creada, sin invitar" que dejaría dos llamadas del cliente.
   * `issue()` de arriba sigue siendo el único camino cuando la invitación es un acto
   * aparte —revocar y reemitir, por ejemplo— y abre su propia transacción para eso.
   */
  async writeInvitation(
    client: PoolClient,
    actorUserId: string,
    targetUserId: string,
    expiresInHours = INVITATION_DEFAULT_HOURS,
  ): Promise<IssueInvitationResponse> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    const { rows } = await client.query<{ id: string; expires_at: Date }>(
      `INSERT INTO user_invitation (user_id, issued_by_user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)
       RETURNING id, expires_at`,
      [targetUserId, actorUserId, hashToken(token), expiresAt],
    );

    const created = rows[0]!;

    return {
      invitationId: created.id,
      userId: targetUserId,
      token,
      expiresAt: created.expires_at.toISOString(),
    };
  }

  async revoke(actor: { userId: string; role: Role }, invitationId: string): Promise<void> {
    if (!isAdministrator(actor.role)) {
      throw forbidden('Only the coordinator can revoke an invitation');
    }

    // Nunca un DELETE: una invitación revocada es parte del rastro de quién intentó
    // dar acceso a quién.
    await asAdministrator(this.db, actor.userId, async (client) => {
      await client.query(
        `UPDATE user_invitation SET revoked_at = now()
          WHERE id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
        [invitationId],
      );
    });
  }

  /**
   * Aceptar es el momento —el único— en que se fija una contraseña sin presentar la
   * anterior. Todo en una transacción: una invitación marcada como aceptada sin
   * credencial detrás, o una credencial creada sin marcar la invitación, serían dos
   * estados que después nadie sabe interpretar.
   */
  async accept(token: string, password: string): Promise<{ userId: string }> {
    // El alcance se declara DESPUÉS de saber a quién pertenece la invitación, así que
    // la transacción se abre a mano: quien acepta es el titular, y el actor de las
    // entradas de auditoría es él mismo. Es el único caso del módulo donde el actor y
    // la cuenta administrada son la misma persona.
    const client = await this.db.unscopedPool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{
        id: string;
        user_id: string;
        expires_at: Date;
        accepted_at: Date | null;
        revoked_at: Date | null;
        deactivated_at: Date | null;
      }>(
        `SELECT i.id, i.user_id, i.expires_at, i.accepted_at, i.revoked_at,
                u.deactivated_at
           FROM user_invitation i JOIN app_user u ON u.id = i.user_id
          WHERE i.token_hash = $1
          FOR UPDATE OF i`,
        [hashToken(token)],
      );

      const invitation = rows[0];

      // Los cuatro motivos —no existe, vencida, ya usada, revocada— comparten
      // respuesta a propósito: distinguirlos convertiría la ruta en un oráculo de qué
      // tokens existieron.
      if (
        !invitation ||
        invitation.revoked_at ||
        invitation.accepted_at ||
        invitation.expires_at.getTime() <= Date.now() ||
        invitation.deactivated_at
      ) {
        throw invitationInvalid();
      }

      const { rows: scope } = await client.query<{ site_ids: string }>(
        `SELECT coalesce(string_agg(site_id::text, ',' ORDER BY site_id), '') AS site_ids
           FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL`,
        [invitation.user_id],
      );

      await client.query('SELECT set_config($1, $2, true)', [
        'app.site_ids',
        scope[0]?.site_ids ?? '',
      ]);
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', invitation.user_id]);

      await this.credentials.create(invitation.user_id, password, client);

      await client.query(`UPDATE user_invitation SET accepted_at = now() WHERE id = $1`, [
        invitation.id,
      ]);

      await client.query('COMMIT');

      return { userId: invitation.user_id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}

/**
 * A lo sumo un token vivo por cuenta (design D1 de
 * `reissue-invitation-link-from-roster`): revoca lo pendiente antes de que el llamador
 * inserte la nueva, dentro de la misma transacción, así nunca hay un instante sin
 * invitación válida ni uno con dos. Nunca DELETE (ADR-002): la que se reemplaza queda
 * leíble como revocada.
 *
 * Exportada y no un método de `InvitationService`: `AccountService.update()` (design D5)
 * la comparte para que corregir el correo y reemitir el link, cuando van juntos, lo hagan
 * en la misma `asAdministrator` sin escribir la regla dos veces.
 */
export async function revokePending(client: PoolClient, targetUserId: string): Promise<void> {
  await client.query(
    `UPDATE user_invitation SET revoked_at = now()
      WHERE user_id = $1 AND accepted_at IS NULL AND revoked_at IS NULL`,
    [targetUserId],
  );
}
