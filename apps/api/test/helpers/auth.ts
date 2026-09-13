import type { Pool } from 'pg';

import { DbService } from '../../src/db/db.service';
import { AuthService } from '../../src/auth/auth.service';
import { CredentialService } from '../../src/auth/credential.service';
import { InvitationService } from '../../src/auth/invitation.service';
import { SessionService } from '../../src/auth/session.service';
import { createBetterAuth } from '../../src/auth/better-auth';
import { inScope } from './postgres';

/**
 * Los servicios reales de autenticación, cableados contra el contenedor del test.
 *
 * Se construyen a mano en vez de levantar el contenedor de Nest: lo que estos specs
 * prueban es el comportamiento de los servicios y del motor, no el cableado de la
 * inyección de dependencias. Las clases son las mismas que corren en producción.
 */
export interface AuthStack {
  db: DbService;
  sessions: SessionService;
  credentials: CredentialService;
  invitations: InvitationService;
  auth: AuthService;
  stop: () => Promise<void>;
}

export function createAuthStack(appUrl: string): AuthStack {
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = appUrl;

  const db = new DbService();

  process.env.DATABASE_URL = previous;

  const sessions = new SessionService(db);

  const auth = createBetterAuth({
    pool: db.unscopedPool,
    secret: 'integration-test-secret-0123456789abcdef',
    baseURL: 'http://localhost:3000',
    onSessionDelete: (sessionId) => sessions.revokeByLibraryDelete(sessionId),
  });

  const credentials = new CredentialService(db, auth);
  const invitations = new InvitationService(db, credentials);
  const authService = new AuthService(db, credentials, sessions);

  return {
    db,
    sessions,
    credentials,
    invitations,
    auth: authService,
    stop: () => db.onModuleDestroy(),
  };
}

/**
 * Da de alta la credencial de una cuenta por el camino real: el coordinador emite la
 * invitación y el titular la acepta. Ningún test crea un hash a mano — si lo hiciera,
 * probaría un estado que el sistema no sabe producir.
 */
export async function grantCredential(
  stack: AuthStack,
  coordinator: { userId: string; role: string },
  targetUserId: string,
  password: string,
): Promise<void> {
  const invitation = await stack.invitations.issue(
    coordinator as { userId: string; role: 'coordinator' },
    targetUserId,
  );

  await stack.invitations.accept(invitation.token, password);
}

/** Las entradas de auditoría de un sitio, por tipo de evento. */
export async function auditEntries(
  pool: Pool,
  siteId: string,
  eventType: string,
): Promise<{ payload: Record<string, unknown>; actor_user_id: string | null }[]> {
  return inScope(
    pool,
    [siteId],
    `SELECT payload, actor_user_id FROM audit_log
      WHERE site_id = $1 AND event_type = $2 ORDER BY seq`,
    [siteId, eventType],
  );
}

/**
 * Vence una invitación FUERA DE BANDA, con el trigger desactivado.
 *
 * `expires_at` es una columna congelada: ni `hs_app` tiene el privilegio ni el guard
 * deja pasar el cambio a ningún rol. Eso es correcto —una invitación no cambia de
 * vencimiento, se revoca y se emite otra— y por eso el test tiene que salirse del
 * sistema para simular el paso del tiempo, igual que los specs del log hacen para
 * simular manipulación. Lo que se prueba es que una invitación vencida no crea
 * credencial, no que se pueda vencer a mano.
 */
export async function expireInvitation(superuser: Pool, invitationId: string): Promise<void> {
  await superuser.query('ALTER TABLE user_invitation DISABLE TRIGGER user_invitation_guard');

  try {
    // Se mueve la emisión al pasado junto con el vencimiento: el CHECK exige
    // `expires_at > issued_at`, así que no alcanza con adelantar solo el vencimiento.
    await superuser.query(
      `UPDATE user_invitation
          SET issued_at = issued_at - interval '4 days',
              expires_at = issued_at - interval '1 day'
        WHERE id = $1`,
      [invitationId],
    );
  } finally {
    await superuser.query('ALTER TABLE user_invitation ENABLE TRIGGER user_invitation_guard');
  }
}

/** Vence a mano el access token de una sesión, para no esperar 15 minutos. */
export async function expireAccessToken(pool: Pool, sessionId: string): Promise<void> {
  await pool.query(
    `UPDATE app_session SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [sessionId],
  );
}

/**
 * Envejece los refresh de una cuenta FUERA DE BANDA. `issued_at` y `expires_at` son
 * columnas congeladas —un token no cambia de vida— así que el test desactiva el guard
 * para simular el paso del tiempo, igual que `expireInvitation`.
 */
export async function ageRefreshTokens(
  superuser: Pool,
  userId: string,
  interval: string,
): Promise<void> {
  await superuser.query('ALTER TABLE app_refresh_token DISABLE TRIGGER app_refresh_token_guard');

  try {
    await superuser.query(
      `UPDATE app_refresh_token
          SET issued_at = issued_at - ($2::text)::interval,
              expires_at = expires_at - ($2::text)::interval
        WHERE session_id IN (SELECT id FROM app_session WHERE user_id = $1)`,
      [userId, interval],
    );
  } finally {
    await superuser.query('ALTER TABLE app_refresh_token ENABLE TRIGGER app_refresh_token_guard');
  }
}
