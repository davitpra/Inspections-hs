import { Injectable } from '@nestjs/common';
import { createOTP } from '@better-auth/utils/otp';
import { base32 } from '@better-auth/utils/base32';
import { randomBytes } from 'node:crypto';
import { requiresTwoFactor, type Role } from '@hs/contracts';

import { DbService } from '../db/db.service';
import { asAdministrator } from './account-scope';
import { forbidden } from './auth.errors';

/**
 * ADR-011 — TOTP obligatorio para `hs_coordinator` y `management`, opcional para el
 * resto.
 *
 * La obligatoriedad NO es una columna ni un `CHECK`: es una propiedad del par (rol,
 * fila confirmada) que se evalúa en cada request. Un `CHECK` que la expresara tendría
 * que mirar `app_user.role` desde otra tabla, que es justo lo que un `CHECK` no
 * puede. Y evaluarla en cada request es lo que hace que ascender a alguien a
 * `management` le corte el acceso pleno en el request siguiente, sin ninguna tarea
 * programada que revise nada (design D7).
 *
 * El TOTP se implementa con `@better-auth/utils/otp` y no con el plugin de segundo
 * factor de better-auth: el plugin trae su propio esquema —una columna en el usuario,
 * códigos de respaldo, confianza de dispositivo— y ninguna de esas tres cosas encaja
 * con un reinicio que solo puede hacer el coordinador.
 */
@Injectable()
export class TwoFactorService {
  /** El período estándar y la tolerancia de un paso hacia cada lado, por deriva. */
  private readonly options = { digits: 6, period: 30 };
  private readonly verifyWindow = 1;

  constructor(private readonly db: DbService) {}

  /** ¿Esta cuenta tiene un segundo factor confirmado y vigente? */
  async hasConfirmed(userId: string): Promise<boolean> {
    const { rows } = await this.db.unscopedPool.query(
      `SELECT 1 FROM app_two_factor
        WHERE user_id = $1 AND revoked_at IS NULL AND confirmed_at IS NOT NULL`,
      [userId],
    );

    return rows.length > 0;
  }

  /**
   * Design D7 — Qué sesión le corresponde a esta cuenta. Es la única función que
   * decide si alguien entra pleno o limitado, y por eso vive sola.
   */
  async purposeFor(userId: string, role: Role): Promise<'full' | 'enrol_two_factor'> {
    if (!requiresTwoFactor(role)) return 'full';

    return (await this.hasConfirmed(userId)) ? 'full' : 'enrol_two_factor';
  }

  /**
   * Emite un secreto. Si había uno sin confirmar se revoca y se emite otro: un
   * secreto emitido y abandonado no debe quedar aceptando códigos para siempre.
   *
   * Es la ÚNICA vez que el secreto sale de la base. Después de confirmar, ninguna
   * ruta lo devuelve.
   */
  async enrol(userId: string, email: string): Promise<{ secret: string; uri: string }> {
    const secret = base32.encode(randomBytes(20), { padding: false });

    // Bajo el alcance del titular: el trigger de auditoría del segundo factor hace
    // fan-out a sus plantas, y sin alcance declarado frena con HS002.
    await asAdministrator(this.db, userId, async (client) => {
      await client.query(
        `UPDATE app_two_factor SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL AND confirmed_at IS NULL`,
        [userId],
      );

      await client.query(`INSERT INTO app_two_factor (user_id, secret) VALUES ($1, $2)`, [
        userId,
        secret,
      ]);
    });

    return {
      secret,
      uri: createOTP(secret, this.options).url('HS Platform', email),
    };
  }

  /**
   * Confirmar es devolver un código válido para el secreto emitido. Recién ahí la
   * cuenta tiene un segundo factor: una fila sin `confirmed_at` es un secreto que
   * todavía no probó nada, y un rol obligatorio sigue sin acceso pleno.
   */
  async confirm(userId: string, code: string): Promise<boolean> {
    const { rows } = await this.db.unscopedPool.query<{ id: string; secret: string }>(
      `SELECT id, secret FROM app_two_factor
        WHERE user_id = $1 AND revoked_at IS NULL AND confirmed_at IS NULL
        ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );

    const pending = rows[0];
    if (!pending) return false;

    const valid = await createOTP(pending.secret, this.options).verify(code, {
      window: this.verifyWindow,
    });

    if (!valid) return false;

    await asAdministrator(this.db, userId, async (client) => {
      await client.query(`UPDATE app_two_factor SET confirmed_at = now() WHERE id = $1`, [
        pending.id,
      ]);
    });

    return true;
  }

  /** La verificación del login, contra el secreto ya confirmado. */
  async verify(userId: string, code: string | undefined): Promise<boolean> {
    if (!code) return false;

    const { rows } = await this.db.unscopedPool.query<{ secret: string }>(
      `SELECT secret FROM app_two_factor
        WHERE user_id = $1 AND revoked_at IS NULL AND confirmed_at IS NOT NULL`,
      [userId],
    );

    const active = rows[0];
    if (!active) return false;

    return createOTP(active.secret, this.options).verify(code, { window: this.verifyWindow });
  }

  /**
   * El reinicio, que solo hace el coordinador. Revoca la fila para que el titular
   * tenga que inscribir de nuevo; nunca pisa el secreto, porque el anterior es un
   * hecho del registro tanto como el nuevo.
   *
   * El titular de un rol obligatorio NO puede quitarse el suyo, y eso se decide acá y
   * no en la ruta: la regla es de esta política, no del transporte.
   */
  async reset(targetUserId: string, actor: { userId: string; role: Role }): Promise<void> {
    if (actor.role !== 'hs_coordinator') {
      throw forbidden('Only the HS coordinator can reset a second factor');
    }

    // Bajo el alcance del COORDINADOR, no el del titular: reiniciarle el segundo
    // factor a alguien de una planta que el coordinador no tiene lo frena el motor.
    await asAdministrator(this.db, actor.userId, async (client) => {
      await client.query(
        `UPDATE app_two_factor SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [targetUserId],
      );
    });
  }
}
