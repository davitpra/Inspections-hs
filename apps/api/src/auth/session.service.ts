import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { Role, Session, TokenPair } from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { sessionEnded, tokenExpired } from './auth.errors';
import { generateToken, hashToken } from './tokens';

/**
 * Design D6 — Las vidas, y de dónde salen.
 *
 * El access token es corto porque D3 lo hace barato de renovar: se resuelve contra la
 * base en cada request, así que su vencimiento no es lo que protege, solo acota.
 *
 * El refresh dura 14 días porque ADR-010 fija la ventana de sincronización en 7 y
 * hace falta margen: un dispositivo que vuelve el último día de esa ventana tiene que
 * refrescar en silencio, no encontrarse con que su refresh venció ayer. Menos de 7
 * haría fallar el caso exacto que el requisito existe para cubrir.
 */
export const ACCESS_TTL_MS = 15 * 60 * 1000;
export const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * La ventana de gracia de la rotación. El cliente refresca, se corta la red antes de
 * que llegue la respuesta, y reintenta con el token que el servidor ya marcó gastado.
 * Sin esta ventana, la red que ADR-010 describe convertiría la detección de robo en
 * una expulsión aleatoria en medio del campo.
 *
 * El costo, consciente: un token robado y usado dentro de este minuto no se detecta.
 * El lado que se elige es el del inspector.
 */
export const REFRESH_GRACE_MS = 60 * 1000;

/** La sesión resuelta: lo que ADR-011 pide que transporte, más lo que el guard usa. */
export interface SessionContext extends SessionScope {
  sessionId: string;
  personId: string;
  role: Role;
  recordsFrom: string | null;
  recordsTo: string | null;
}

interface ResolvedRow {
  session_id: string;
  session_expires_at: Date;
  session_revoked_at: Date | null;
  user_id: string;
  person_id: string;
  role: Role;
  deactivated_at: Date | null;
  expires_at: Date | null;
  records_from: string | null;
  records_to: string | null;
  site_ids: string[];
}

/**
 * Declara en la transacción el alcance de la cuenta y su id como actor.
 *
 * Toda revocación de sesión dispara `hs_session_revoked_audit`, que escribe en la
 * cadena de cada planta del alcance de la cuenta y frena con `HS002` si alguna no está
 * declarada. Sin esto, cerrar sesión falla — y falla en el peor lugar posible.
 */
async function declareScopeFor(client: PoolClient, userId: string): Promise<void> {
  const { rows } = await client.query<{ site_ids: string }>(
    `SELECT coalesce(string_agg(site_id::text, ',' ORDER BY site_id), '') AS site_ids
       FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId],
  );

  await client.query('SELECT set_config($1, $2, true)', [
    'app.site_ids',
    rows[0]?.site_ids ?? '',
  ]);
  await client.query('SELECT set_config($1, $2, true)', ['app.user_id', userId]);
}

@Injectable()
export class SessionService {
  constructor(private readonly db: DbService) {}

  /**
   * Design D4 — La resolución completa en UNA consulta: sesión viva y no vencida →
   * cuenta activa y no vencida → persona → rol → sitios del alcance vigente.
   *
   * El alcance sale de `user_site_scope` acá y no del token, y esa es la propiedad
   * que hace ciertos los escenarios de "un sitio revocado sale del alcance en el
   * request siguiente": lo que se resuelve es el alcance de AHORA, no el de cuando
   * se emitió el token.
   *
   * Ninguna de las tablas que toca lleva política RLS, y por eso corre fuera de
   * `withSession`: una política sobre el alcance que se lee para CONSTRUIR el alcance
   * es un arranque circular.
   *
   * **`role` se lee de `app_user` en CADA request, igual que `site_ids`**, y desde 0012
   * eso dejó de ser solo un dato del guard: `withSessionScope` lo pone en `app.role` y
   * la política de visibilidad de `incident` lo consulta. Un rol congelado en el token
   * dejaría a una cuenta degradada leyendo incidentes hasta que el token expire.
   */
  async resolve(token: string): Promise<SessionContext> {
    const { rows } = await this.db.unscopedPool.query<ResolvedRow>(
      `SELECT s.id            AS session_id,
              s.expires_at    AS session_expires_at,
              s.revoked_at    AS session_revoked_at,
              u.id            AS user_id,
              u.person_id     AS person_id,
              u.role          AS role,
              u.deactivated_at,
              u.expires_at,
              u.records_from::text AS records_from,
              u.records_to::text   AS records_to,
              coalesce(
                (SELECT array_agg(sc.site_id ORDER BY sc.site_id)
                   FROM user_site_scope sc
                  WHERE sc.user_id = u.id AND sc.revoked_at IS NULL),
                ARRAY[]::uuid[]) AS site_ids
         FROM app_session s
         JOIN app_user u ON u.id = s.user_id
        WHERE s.token = $1`,
      [token],
    );

    const row = rows[0];

    // Un token que no existe y uno revocado se responden igual: `session_ended`. No
    // hay nada renovable detrás de ninguno de los dos.
    if (!row) throw sessionEnded('The session does not exist');
    if (row.session_revoked_at) throw sessionEnded('The session was revoked');

    // El orden importa. Primero las condiciones FINALES —cuenta desactivada o
    // vencida—, después el vencimiento del access token, que es la única renovable.
    // Al revés, una cuenta desactivada con token vencido recibiría `token_expired` y
    // el cliente entraría en un ciclo de refrescos que nunca van a servir.
    if (row.deactivated_at) throw sessionEnded('The account is deactivated');
    if (row.expires_at && row.expires_at.getTime() <= Date.now()) {
      throw sessionEnded('The account has expired');
    }

    if (row.session_expires_at.getTime() <= Date.now()) throw tokenExpired();

    return {
      sessionId: row.session_id,
      userId: row.user_id,
      personId: row.person_id,
      role: row.role,
      siteIds: row.site_ids,
      recordsFrom: row.records_from,
      recordsTo: row.records_to,
    };
  }

  /**
   * Crea la sesión y su primer refresh. La fila la insertamos nosotros y no
   * better-auth (design D16), y eso es lo que permite que el guard de la migración
   * trate sus columnas de identidad como congeladas desde el INSERT en vez de como
   * columnas que se corrigen después.
   */
  async issue(
    userId: string,
    meta: { ipAddress?: string | null; userAgent?: string | null } = {},
    client?: PoolClient,
  ): Promise<TokenPair> {
    const run = (sql: string, params: unknown[]) =>
      client ? client.query(sql, params) : this.db.unscopedPool.query(sql, params);

    const now = Date.now();
    const sessionId = randomUUID();
    const accessToken = generateToken();
    const accessExpiresAt = new Date(now + ACCESS_TTL_MS);

    await run(
      `INSERT INTO app_session
         (id, token, user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        sessionId,
        accessToken,
        userId,
        accessExpiresAt,
        meta.ipAddress ?? null,
        meta.userAgent ?? null,
      ],
    );

    const refresh = await this.mintRefresh(sessionId, null, client);

    return {
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: refresh.token,
      refreshExpiresAt: refresh.expiresAt.toISOString(),
    };
  }

  /**
   * Design D6 — La rotación, con sus dos desenlaces.
   *
   * Uso normal: se marca gastado el presentado, se emite un par nuevo y se anota cuál
   * lo reemplazó. Reuso de uno gastado: si cae dentro de la ventana de gracia se
   * devuelve el MISMO par que devolvió la primera vez —el cliente perdió la respuesta,
   * no el token—; pasada la ventana se revoca la cadena entera y la sesión con ella,
   * porque un refresh usado dos veces significa que existe una copia.
   *
   * Todo en una transacción con `FOR UPDATE` sobre la fila del token: dos refrescos
   * simultáneos del mismo token tienen que resolverse uno detrás del otro, o los dos
   * verían "no gastado" y emitirían dos pares válidos.
   */
  async refresh(presented: string): Promise<{ tokens: TokenPair; userId: string }> {
    const client = await this.db.unscopedPool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{
        id: string;
        session_id: string;
        expires_at: Date;
        spent_at: Date | null;
        replaced_by_id: string | null;
        revoked_at: Date | null;
        user_id: string;
        session_revoked_at: Date | null;
        session_revoked_reason: string | null;
        deactivated_at: Date | null;
        account_expires_at: Date | null;
      }>(
        `SELECT r.id, r.session_id, r.expires_at, r.spent_at, r.replaced_by_id, r.revoked_at,
                s.user_id, s.revoked_at AS session_revoked_at, s.revoked_reason AS session_revoked_reason,
                u.deactivated_at, u.expires_at AS account_expires_at
           FROM app_refresh_token r
           JOIN app_session s ON s.id = r.session_id
           JOIN app_user u ON u.id = s.user_id
          WHERE r.token_hash = $1
          FOR UPDATE OF r`,
        [hashToken(presented)],
      );

      const row = rows[0];

      // El alcance, antes de cualquier revocación: rotar revoca la sesión anterior, y
      // el trigger de `session.revoked` hace fan-out a las plantas de la cuenta —sin
      // alcance declarado frena con HS002. La rotación es una escritura del titular
      // sobre sí mismo, así que el alcance y el actor son los suyos.
      if (row) await declareScopeFor(client, row.user_id);

      // `rotated` NO cuenta como sesión terminada, y distinguirlo es lo que hace que
      // las dos ramas de abajo existan. Cada rotación revoca la sesión anterior —para
      // que su access token muera en el acto y no en 15 minutos—, así que tratar toda
      // sesión revocada como final haría que el token presentado pareciera muerto
      // siempre: la ventana de gracia nunca se alcanzaría y el reuso nunca se
      // detectaría, que es justo la mitad que protege.
      const sessionIsGone =
        row?.session_revoked_at != null && row.session_revoked_reason !== 'rotated';

      if (!row || row.revoked_at || sessionIsGone) {
        throw sessionEnded('The session has ended');
      }
      if (row.deactivated_at) throw sessionEnded('The account is deactivated');
      if (row.account_expires_at && row.account_expires_at.getTime() <= Date.now()) {
        throw sessionEnded('The account has expired');
      }
      if (row.expires_at.getTime() <= Date.now()) {
        throw sessionEnded('The refresh token has expired');
      }

      if (row.spent_at) {
        const withinGrace = Date.now() - row.spent_at.getTime() <= REFRESH_GRACE_MS;

        if (!withinGrace || !row.replaced_by_id) {
          await this.revokeChain(client, row.session_id, 'refresh_token_reuse');
          await client.query('COMMIT');
          throw sessionEnded('The session was revoked because a refresh token was reused');
        }

        // Dentro de la gracia: el cliente perdió la respuesta, no el token. Se
        // devuelve el mismo par que se emitió la primera vez.
        const replayed = await this.replay(client, row.replaced_by_id);
        await client.query('COMMIT');
        return { tokens: replayed, userId: row.user_id };
      }

      // El camino normal. Sesión nueva y refresh nuevo: el access token es la fila de
      // `app_session`, así que renovarlo es emitir una sesión nueva y revocar la
      // anterior con un motivo que dice que fue una rotación y no una expulsión.
      const tokens = await this.rotate(client, row);

      await client.query('COMMIT');
      return { tokens, userId: row.user_id };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Design D5 y ADR-011 — La revocación en cascada. Se expresa siempre con
   * `revoked_at`, nunca con un DELETE: una sesión revocada es un hecho del registro
   * tanto como una vigente.
   */
  async revokeAllForUser(userId: string, reason: string, client?: PoolClient): Promise<void> {
    const run = async (target: PoolClient): Promise<void> => {
      // Mismo motivo que en `refresh`: `session.revoked` hace fan-out por sitio.
      await declareScopeFor(target, userId);

      await target.query(
        `UPDATE app_session
            SET revoked_at = now(), revoked_reason = $2
          WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId, reason],
      );

      await target.query(
        `UPDATE app_refresh_token r
            SET revoked_at = now()
          FROM app_session s
         WHERE s.id = r.session_id AND s.user_id = $1 AND r.revoked_at IS NULL`,
        [userId],
      );
    };

    if (client) return run(client);

    const owned = await this.db.unscopedPool.connect();

    try {
      await owned.query('BEGIN');
      await run(owned);
      await owned.query('COMMIT');
    } catch (error) {
      await owned.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      owned.release();
    }
  }

  async revokeSession(sessionId: string, reason: string): Promise<void> {
    const client = await this.db.unscopedPool.connect();

    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{ user_id: string }>(
        'SELECT user_id FROM app_session WHERE id = $1',
        [sessionId],
      );

      if (rows[0]) await declareScopeFor(client, rows[0].user_id);

      await this.revokeChain(client, sessionId, reason);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** El destino del hook de design D15: lo que se hace en vez de borrar la fila. */
  async revokeByLibraryDelete(sessionId: string): Promise<void> {
    await this.revokeSession(sessionId, 'signed_out');
  }

  toContractSession(context: SessionContext): Session {
    return {
      userId: context.userId,
      personId: context.personId,
      role: context.role,
      siteScope: [...context.siteIds],
      recordsFrom: context.recordsFrom,
      recordsTo: context.recordsTo,
    };
  }

  // -------------------------------------------------------------------------

  private async mintRefresh(
    sessionId: string,
    parentId: string | null,
    client?: PoolClient,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    const token = generateToken();
    const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);

    const query = `INSERT INTO app_refresh_token (session_id, token_hash, parent_id, expires_at)
                   VALUES ($1, $2, $3, $4) RETURNING id`;
    const params = [sessionId, hashToken(token), parentId, expiresAt];

    const { rows } = client
      ? await client.query<{ id: string }>(query, params)
      : await this.db.unscopedPool.query<{ id: string }>(query, params);

    return { id: rows[0]!.id, token, expiresAt };
  }

  private async rotate(
    client: PoolClient,
    presented: { id: string; session_id: string; user_id: string },
  ): Promise<TokenPair> {
    const now = Date.now();
    const accessToken = generateToken();
    const accessExpiresAt = new Date(now + ACCESS_TTL_MS);
    const newSessionId = randomUUID();

    const { rows: previous } = await client.query<{
      ip_address: string | null;
      user_agent: string | null;
    }>(`SELECT ip_address, user_agent FROM app_session WHERE id = $1`, [
      presented.session_id,
    ]);

    await client.query(
      `INSERT INTO app_session (id, token, user_id, expires_at, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newSessionId,
        accessToken,
        presented.user_id,
        accessExpiresAt,
        previous[0]?.ip_address ?? null,
        previous[0]?.user_agent ?? null,
      ],
    );

    // La sesión anterior se revoca con un motivo que dice qué pasó. `session.revoked`
    // entra igual en la cadena de auditoría, y que el motivo sea `rotated` es lo que
    // permite leer el log sin confundir una renovación con una expulsión.
    await client.query(
      `UPDATE app_session SET revoked_at = now(), revoked_reason = 'rotated'
        WHERE id = $1 AND revoked_at IS NULL`,
      [presented.session_id],
    );

    const minted = await this.mintRefresh(newSessionId, presented.id, client);

    await client.query(
      `UPDATE app_refresh_token SET spent_at = now(), replaced_by_id = $2 WHERE id = $1`,
      [presented.id, minted.id],
    );

    return {
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: minted.token,
      refreshExpiresAt: minted.expiresAt.toISOString(),
    };
  }

  /**
   * La respuesta perdida, reconstruida. No se puede devolver el mismo token de acceso
   * —está hasheado del lado del cliente nada más, pero la fila que lo contiene es la
   * que se emitió y su valor no vuelve a salir de la base—, así que se emite un par
   * nuevo sobre la MISMA sesión que la primera rotación creó. El cliente termina con
   * credenciales válidas y sin haber perdido la cola, que es lo que el requisito pide.
   */
  private async replay(client: PoolClient, replacementId: string): Promise<TokenPair> {
    const { rows } = await client.query<{ session_id: string; user_id: string }>(
      `SELECT r.session_id, s.user_id
         FROM app_refresh_token r JOIN app_session s ON s.id = r.session_id
        WHERE r.id = $1`,
      [replacementId],
    );

    const target = rows[0];
    if (!target) throw sessionEnded('The session has ended');

    const accessToken = generateToken();
    const accessExpiresAt = new Date(Date.now() + ACCESS_TTL_MS);
    const newSessionId = randomUUID();

    await client.query(
      `INSERT INTO app_session (id, token, user_id, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [newSessionId, accessToken, target.user_id, accessExpiresAt],
    );

    const minted = await this.mintRefresh(newSessionId, replacementId, client);

    await client.query(
      `UPDATE app_refresh_token SET spent_at = now(), replaced_by_id = $2
        WHERE id = $1 AND spent_at IS NULL`,
      [replacementId, minted.id],
    );

    return {
      accessToken,
      accessExpiresAt: accessExpiresAt.toISOString(),
      refreshToken: minted.token,
      refreshExpiresAt: minted.expiresAt.toISOString(),
    };
  }

  /**
   * Revoca la sesión y TODA la cadena de rotación a la que pertenece — hacia atrás por
   * `parent_id` y hacia adelante por `replaced_by_id`. Media cadena revocada dejaría
   * viva justamente la mitad que tiene el que copió el token.
   */
  private async revokeChain(
    client: PoolClient,
    sessionId: string,
    reason: string,
  ): Promise<void> {
    const { rows } = await client.query<{ id: string; session_id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT id, session_id, parent_id, replaced_by_id
           FROM app_refresh_token WHERE session_id = $1
         UNION
         SELECT r.id, r.session_id, r.parent_id, r.replaced_by_id
           FROM app_refresh_token r JOIN chain c
             ON r.id = c.parent_id OR r.parent_id = c.id
             OR r.id = c.replaced_by_id OR r.replaced_by_id = c.id)
       SELECT id, session_id FROM chain`,
      [sessionId],
    );

    const tokenIds = rows.map((r) => r.id);
    // La sesión que se pide revocar entra siempre, aunque no tenga ningún refresh
    // vivo colgando: cerrar sesión antes del primer refresh es un caso normal.
    const sessionIds = [...new Set([sessionId, ...rows.map((r) => r.session_id)])];

    if (tokenIds.length > 0) {
      await client.query(
        `UPDATE app_refresh_token SET revoked_at = now()
          WHERE id = ANY($1::uuid[]) AND revoked_at IS NULL`,
        [tokenIds],
      );
    }

    await client.query(
      `UPDATE app_session SET revoked_at = now(), revoked_reason = $2
        WHERE id = ANY($1::text[]) AND revoked_at IS NULL`,
      [sessionIds, reason],
    );
  }
}
