import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  acceptInvitationRequestSchema,
  issueInvitationRequestSchema,
  refreshRequestSchema,
  revokeSessionsRequestSchema,
  signInRequestSchema,
} from '@hs/contracts';

import { AuthException } from '../src/auth/auth.errors';
import { REFRESH_GRACE_MS } from '../src/auth/session.service';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import {
  ageRefreshTokens,
  auditEntries,
  createAuthStack,
  expireAccessToken,
  expireInvitation,
  grantCredential,
  type AuthStack,
} from './helpers/auth';

/**
 * ADR-011 — Autenticación y sesiones.
 *
 * Lo que este spec protege son las cuatro propiedades por las que el change existe:
 *
 * 1. Que `app.site_ids` sea una consecuencia de quién inició sesión y no un argumento
 *    —la propiedad que la etapa 2 de §7 tiene que dejar probada.
 * 2. Que un 401 sobre un envío diferido sea siempre distinguible entre "renová y
 *    reintentá" y "pará", que es lo único que hace implementable el requisito offline.
 * 3. Que revocar —una cuenta, un sitio, un segundo factor— valga en el request
 *    siguiente y no cuando expire un token.
 * 4. Que cerrar sesión CIERRE la sesión. No es obvio: better-auth responde
 *    `200 {"success":true}` cuando el motor le frena el DELETE, así que de esto no se
 *    prueba la respuesta sino el estado de la fila y si el token sigue sirviendo
 *    (design D15).
 */

const SITE_A = '88888888-0000-4000-8000-00000000000a';
const SITE_B = '88888888-0000-4000-8000-00000000000b';

const APPEND_ONLY = 'HS001';
const INSUFFICIENT_PRIVILEGE = '42501';

const PASSWORD = 'a-long-enough-password';

let db: TestDatabase;
let stack: AuthStack;

/** El coordinador, que es quien invita a todos los demás. */
let coordinator: { userId: string; role: 'hs_coordinator'; email: string };

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createAuthStack(db.appUrl);

  await registerSite(db.migrator, SITE_A, 'auth-a', 'Auth A');
  await registerSite(db.migrator, SITE_B, 'auth-b', 'Auth B');

  const account = await createAccount(db.app, {
    role: 'hs_coordinator',
    siteIds: [SITE_A, SITE_B],
    email: 'coordinator@auth.test',
  });

  coordinator = { userId: account.accountId, role: 'hs_coordinator', email: account.email };
}, 240_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

/** Una cuenta nueva con credencial, dada de alta por el camino real. */
async function account(spec: {
  role?: string;
  siteIds?: readonly string[];
  email?: string;
  firstName?: string;
  lastName?: string;
  expiresAt?: Date | null;
  recordsFrom?: string | null;
  recordsTo?: string | null;
  withCredential?: boolean;
}) {
  const created = await createAccount(db.app, {
    role: spec.role ?? 'jhsc_member',
    siteIds: spec.siteIds ?? [SITE_A],
    email: spec.email,
    firstName: spec.firstName,
    lastName: spec.lastName,
    expiresAt: spec.expiresAt ?? null,
    recordsFrom: spec.recordsFrom ?? null,
    recordsTo: spec.recordsTo ?? null,
  });

  if (spec.withCredential !== false) {
    await grantCredential(stack, coordinator, created.accountId, PASSWORD);
  }

  return created;
}

/** El código de un `AuthException`, que es lo que el cliente del outbox lee. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AuthException) return error.code;
    throw error;
  }

  throw new Error('Se esperaba un error de autenticación y no hubo ninguno.');
}

// ---------------------------------------------------------------------------

describe('la invitación es la única puerta al sistema', () => {
  it('el coordinador invita una cuenta sin credencial', async () => {
    const created = await account({ withCredential: false, email: 'invited@auth.test' });

    const invitation = await stack.invitations.issue(coordinator, created.accountId);

    expect(invitation.userId).toBe(created.accountId);
    expect(invitation.token).toBeTruthy();

    const rows = await inScope<{ issued_by_user_id: string; token_hash: string }>(
      db.app,
      [],
      'SELECT issued_by_user_id, token_hash FROM user_invitation WHERE id = $1',
      [invitation.invitationId],
    );

    expect(one(rows).issued_by_user_id).toBe(coordinator.userId);
    // El token viaja en claro una sola vez; lo que queda guardado es su hash.
    expect(one(rows).token_hash).not.toBe(invitation.token);
  });

  it('ningún otro rol puede invitar', async () => {
    const member = await account({ role: 'jhsc_member', withCredential: false });
    const target = await account({ withCredential: false });

    const code = await codeOf(() =>
      stack.invitations.issue(
        { userId: member.accountId, role: 'jhsc_member' as never },
        target.accountId,
      ),
    );

    expect(code).toBe('forbidden');
  });

  it('una cuenta que ya tiene credencial no se puede invitar de nuevo', async () => {
    const existing = await account({});

    const code = await codeOf(() => stack.invitations.issue(coordinator, existing.accountId));

    expect(code).toBe('invitation_invalid');
  });

  it('una invitación vencida no crea credencial', async () => {
    const target = await account({ withCredential: false });
    const invitation = await stack.invitations.issue(coordinator, target.accountId);

    await expireInvitation(db.superuser, invitation.invitationId);

    const code = await codeOf(() => stack.invitations.accept(invitation.token, PASSWORD));

    expect(code).toBe('invitation_invalid');
    expect(await stack.credentials.hasActive(target.accountId)).toBe(false);
  });

  it('una invitación no se puede usar dos veces', async () => {
    const target = await account({ withCredential: false });
    const invitation = await stack.invitations.issue(coordinator, target.accountId);

    await stack.invitations.accept(invitation.token, PASSWORD);

    const code = await codeOf(() => stack.invitations.accept(invitation.token, 'another-password'));

    expect(code).toBe('invitation_invalid');
  });

  it('una invitación revocada no crea credencial', async () => {
    const target = await account({ withCredential: false });
    const invitation = await stack.invitations.issue(coordinator, target.accountId);

    await stack.invitations.revoke(coordinator, invitation.invitationId);

    const code = await codeOf(() => stack.invitations.accept(invitation.token, PASSWORD));

    expect(code).toBe('invitation_invalid');
    expect(await stack.credentials.hasActive(target.accountId)).toBe(false);
  });

  it('una invitación nunca se borra, ni siquiera para el dueño del esquema', async () => {
    const target = await account({ withCredential: false });
    const invitation = await stack.invitations.issue(coordinator, target.accountId);

    await expect(
      db.app.query('DELETE FROM user_invitation WHERE id = $1', [invitation.invitationId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    await expect(
      db.migrator.query('DELETE FROM user_invitation WHERE id = $1', [invitation.invitationId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);

    const rows = await inScope(db.app, [], 'SELECT id FROM user_invitation WHERE id = $1', [
      invitation.invitationId,
    ]);

    expect(rows).toHaveLength(1);
  });
});

describe('el login', () => {
  it('una cuenta activa con credencial entra', async () => {
    const created = await account({ email: 'active@auth.test' });

    const result = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    expect(result.session.userId).toBe(created.accountId);
    expect(result.session.personId).toBe(created.personId);
    expect(result.tokens.accessToken).toBeTruthy();
    expect(result.tokens.refreshToken).toBeTruthy();
  });

  it('una cuenta desactivada no entra', async () => {
    const created = await account({ email: 'deactivated@auth.test' });

    await stack.db.withSiteScope({ siteIds: [SITE_A], userId: coordinator.userId }, async (dbx) => {
      await dbx.execute(
        `UPDATE app_user SET deactivated_at = now() WHERE id = '${created.accountId}'` as never,
      );
    });

    expect(await codeOf(() => stack.auth.signIn({ email: created.email, password: PASSWORD }))).toBe(
      'invalid_credentials',
    );
  });

  it('un auditor externo vencido no entra', async () => {
    const created = await createAccount(db.app, {
      role: 'external_auditor',
      siteIds: [SITE_A],
      email: 'expired-auditor@auth.test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      recordsFrom: '2026-01-01',
      recordsTo: '2026-06-30',
    });

    await grantCredential(stack, coordinator, created.accountId, PASSWORD);

    // Se vence a mano: el CHECK impide crear una cuenta ya vencida, que es correcto.
    // Bajo alcance, porque cambiar `expires_at` dispara `user.expiry_changed`, que
    // hace fan-out a las plantas de la cuenta.
    await inScope(
      db.migrator,
      [SITE_A],
      // Un microsegundo después del alta: el CHECK exige `expires_at > created_at`, y
      // un segundo caería en el futuro porque la cuenta se creó recién.
      `UPDATE app_user SET expires_at = created_at + interval '1 microsecond' WHERE id = $1`,
      [created.accountId],
    );

    expect(await codeOf(() => stack.auth.signIn({ email: created.email, password: PASSWORD }))).toBe(
      'invalid_credentials',
    );
  });

  it('una cuenta sin credencial no entra', async () => {
    const created = await account({ withCredential: false, email: 'no-credential@auth.test' });

    expect(await codeOf(() => stack.auth.signIn({ email: created.email, password: PASSWORD }))).toBe(
      'invalid_credentials',
    );
  });

  it('email desconocido y contraseña incorrecta son indistinguibles', async () => {
    const created = await account({ email: 'real@auth.test' });

    const unknown = await codeOf(() =>
      stack.auth.signIn({ email: 'nobody@auth.test', password: PASSWORD }),
    );
    const wrong = await codeOf(() =>
      stack.auth.signIn({ email: created.email, password: 'the-wrong-password' }),
    );

    expect(unknown).toBe(wrong);
    expect(unknown).toBe('invalid_credentials');
  });

  it('ninguna respuesta lleva el hash de la contraseña', async () => {
    const created = await account({ email: 'nohash@auth.test' });

    const result = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    expect(JSON.stringify(result)).not.toContain('$');
    expect(Object.keys(result.session)).not.toContain('password');
  });
});

describe('el bloqueo por intentos fallidos', () => {
  it('cinco fallos bloquean, y la contraseña correcta sigue sin entrar', async () => {
    const created = await account({ email: 'locked@auth.test' });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await codeOf(() => stack.auth.signIn({ email: created.email, password: 'wrong' }));
    }

    expect(await codeOf(() => stack.auth.signIn({ email: created.email, password: PASSWORD }))).toBe(
      'account_locked',
    );
  });

  it('el bloqueo no desactiva la cuenta', async () => {
    const rows = await inScope<{ deactivated_at: Date | null }>(
      db.app,
      [],
      `SELECT deactivated_at FROM app_user WHERE email = 'locked@auth.test'`,
    );

    expect(one(rows).deactivated_at).toBeNull();
  });

  it('un login exitoso pone el contador en cero', async () => {
    const created = await account({ email: 'counter@auth.test' });

    await codeOf(() => stack.auth.signIn({ email: created.email, password: 'wrong' }));
    await stack.auth.signIn({ email: created.email, password: PASSWORD });

    const credential = await stack.credentials.find(created.accountId);

    expect(credential?.failedAttempts).toBe(0);
    expect(credential?.lockedUntil).toBeNull();
  });
});

describe('el alcance sale de la sesión y de ningún otro lado', () => {
  it('la sesión resuelve user, person y alcance', async () => {
    const created = await account({ siteIds: [SITE_A], email: 'scope-one@auth.test' });

    const { session } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    expect(session.userId).toBe(created.accountId);
    expect(session.personId).toBe(created.personId);
    expect(session.siteScope).toEqual([SITE_A]);
  });

  /**
   * La sesión también dice QUIÉN, no solo qué puede. Sin esto la interfaz tenía ids y un
   * rol, y en un dispositivo compartido nadie podía confirmar de quién era el borrador
   * antes de firmarlo (ADR-001: un dueño, un dispositivo, un firmante).
   *
   * El email sale de `app_user` durante la resolución del token; el nombre sale de
   * `person`, que está aislada por sitio, y por eso se lee aparte y bajo alcance. Este
   * test existe para que esa segunda lectura no se pierda en un refactor —si se
   * perdiera, la sesión seguiría siendo válida y el nombre simplemente desaparecería.
   */
  it('la sesión dice quién es la persona, no solo qué puede', async () => {
    const created = await account({
      email: 'identity@auth.test',
      firstName: 'Ada',
      lastName: 'Reid',
    });

    const { session, tokens } = await stack.auth.signIn({
      email: created.email,
      password: PASSWORD,
    });

    expect(session.email).toBe('identity@auth.test');
    expect(session.firstName).toBe('Ada');
    expect(session.lastName).toBe('Reid');

    // Y por el mismo camino que usa `GET /auth/session` al reabrir la aplicación, no
    // solo en la respuesta del login.
    const resolved = await stack.sessions.toContractSession(
      await stack.sessions.resolve(tokens.accessToken),
    );

    expect(resolved.firstName).toBe('Ada');
    expect(resolved.email).toBe('identity@auth.test');
  });

  it('revocar un sitio lo saca del alcance con el MISMO token', async () => {
    const created = await account({ siteIds: [SITE_A, SITE_B], email: 'scope-revoke@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    const before = await stack.sessions.resolve(tokens.accessToken);
    expect([...before.siteIds].sort()).toEqual([SITE_A, SITE_B].sort());

    await stack.db.withSiteScope({ siteIds: [SITE_A, SITE_B], userId: coordinator.userId }, async (dbx) => {
      await dbx.execute(
        `UPDATE user_site_scope SET revoked_at = now()
          WHERE user_id = '${created.accountId}' AND site_id = '${SITE_B}'` as never,
      );
    });

    const after = await stack.sessions.resolve(tokens.accessToken);
    expect(after.siteIds).toEqual([SITE_A]);
  });

  it('otorgar un sitio lo agrega con el MISMO token', async () => {
    const created = await account({ siteIds: [SITE_A], email: 'scope-grant@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    await stack.db.withSiteScope({ siteIds: [SITE_A, SITE_B], userId: coordinator.userId }, async (dbx) => {
      await dbx.execute(
        `INSERT INTO user_site_scope (user_id, site_id)
         VALUES ('${created.accountId}', '${SITE_B}')` as never,
      );
    });

    const after = await stack.sessions.resolve(tokens.accessToken);
    expect([...after.siteIds].sort()).toEqual([SITE_A, SITE_B].sort());
  });

  it('una cuenta sin alcance activo no ve nada, y no es un error', async () => {
    const created = await account({ siteIds: [SITE_A], email: 'scope-none@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    await stack.db.withSiteScope({ siteIds: [SITE_A], userId: coordinator.userId }, async (dbx) => {
      await dbx.execute(
        `UPDATE user_site_scope SET revoked_at = now()
          WHERE user_id = '${created.accountId}'` as never,
      );
    });

    const session = await stack.sessions.resolve(tokens.accessToken);
    expect(session.siteIds).toEqual([]);

    const people = await stack.db.withSession(session, async (dbx) =>
      dbx.execute(`SELECT id FROM person` as never),
    );

    expect((people as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('la sesión de un miembro de una planta no alcanza a la otra', async () => {
    const created = await account({ siteIds: [SITE_A], email: 'isolated@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    const result = await stack.db.withSession(session, async (dbx) =>
      dbx.execute(`SELECT site_id FROM person` as never),
    );

    const rows = (result as unknown as { rows: { site_id: string }[] }).rows;

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.site_id === SITE_A)).toBe(true);
  });
});

describe('el refresh', () => {
  it('renueva sin contraseña', async () => {
    const created = await account({ email: 'refresh@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    const renewed = await stack.sessions.refresh(tokens.refreshToken);

    expect(renewed.tokens.accessToken).not.toBe(tokens.accessToken);
    expect(renewed.tokens.refreshToken).not.toBe(tokens.refreshToken);

    const session = await stack.sessions.resolve(renewed.tokens.accessToken);
    expect(session.userId).toBe(created.accountId);
  });

  it('un access token vencido se reporta como RENOVABLE', async () => {
    const created = await account({ email: 'expired-token@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    await expireAccessToken(db.app, session.sessionId);

    expect(await codeOf(() => stack.sessions.resolve(tokens.accessToken))).toBe('token_expired');
  });

  it('una sesión revocada se reporta como FINAL', async () => {
    const created = await account({ email: 'revoked-token@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    await stack.sessions.revokeSession(session.sessionId, 'test');

    expect(await codeOf(() => stack.sessions.resolve(tokens.accessToken))).toBe('session_ended');
    expect(await codeOf(() => stack.sessions.refresh(tokens.refreshToken))).toBe('session_ended');
  });

  it('reusar un refresh gastado revoca la cadena entera', async () => {
    const created = await account({ email: 'reuse@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    const renewed = await stack.sessions.refresh(tokens.refreshToken);

    // Fuera de la ventana de gracia: se envejece el `spent_at` en vez de esperar.
    await db.app.query(
      `UPDATE app_refresh_token SET spent_at = now() - interval '10 minutes'
        WHERE spent_at IS NOT NULL AND session_id IN (
          SELECT id FROM app_session WHERE user_id = $1)`,
      [created.accountId],
    );

    expect(await codeOf(() => stack.sessions.refresh(tokens.refreshToken))).toBe('session_ended');

    // Y el par nuevo tampoco sirve: media cadena revocada dejaría viva justamente la
    // mitad que tiene el que copió el token.
    expect(await codeOf(() => stack.sessions.resolve(renewed.tokens.accessToken))).toBe(
      'session_ended',
    );
  });

  it('reusar dentro de la ventana de gracia devuelve un par válido sin revocar nada', async () => {
    const created = await account({ email: 'grace@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    await stack.sessions.refresh(tokens.refreshToken);

    // El cliente perdió la respuesta y reintenta con el mismo token, dentro del minuto.
    const replayed = await stack.sessions.refresh(tokens.refreshToken);

    const session = await stack.sessions.resolve(replayed.tokens.accessToken);
    expect(session.userId).toBe(created.accountId);
    expect(REFRESH_GRACE_MS).toBe(60_000);
  });

  it('un refresh de 8 días —dentro de la ventana de ADR-010— sigue sirviendo', async () => {
    const created = await account({ email: 'eight-days@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    await ageRefreshTokens(db.superuser, created.accountId, '8 days');

    const renewed = await stack.sessions.refresh(tokens.refreshToken);
    expect(renewed.tokens.accessToken).toBeTruthy();
  });
});

describe('la revocación', () => {
  it('desactivar la cuenta termina sus sesiones', async () => {
    const created = await account({ email: 'deactivate-session@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });

    await stack.db.withSiteScope({ siteIds: [SITE_A], userId: coordinator.userId }, async (dbx) => {
      await dbx.execute(
        `UPDATE app_user SET deactivated_at = now() WHERE id = '${created.accountId}'` as never,
      );
    });

    expect(await codeOf(() => stack.sessions.resolve(tokens.accessToken))).toBe('session_ended');
  });

  it('cerrar sesión la CIERRA — la fila queda revocada y el token deja de servir', async () => {
    const created = await account({ email: 'signout@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    await stack.auth.signOut(session.sessionId);

    // Design D15: de esto NO se prueba la respuesta. better-auth contesta
    // `200 {"success":true}` aunque el DELETE haya fallado, así que lo que se verifica
    // es el estado de la fila y si el token sigue autenticando.
    const rows = await inScope<{ revoked_at: Date | null; revoked_reason: string | null }>(
      db.app,
      [],
      'SELECT revoked_at, revoked_reason FROM app_session WHERE id = $1',
      [session.sessionId],
    );

    expect(one(rows).revoked_at).not.toBeNull();
    expect(one(rows).revoked_reason).toBe('signed_out');
    expect(await codeOf(() => stack.sessions.resolve(tokens.accessToken))).toBe('session_ended');
  });

  it('una sesión no se borra nunca, ni siquiera para el dueño del esquema', async () => {
    const created = await account({ email: 'no-delete@auth.test' });
    const { tokens } = await stack.auth.signIn({ email: created.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    await expect(
      db.app.query('DELETE FROM app_session WHERE id = $1', [session.sessionId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === INSUFFICIENT_PRIVILEGE);

    await expect(
      db.migrator.query('DELETE FROM app_session WHERE id = $1', [session.sessionId]),
    ).rejects.toSatisfy((error) => sqlstate(error) === APPEND_ONLY);
  });

});

describe('el auditor externo', () => {
  it('la ventana de fechas acota su lectura por los dos lados', async () => {
    const auditor = await createAccount(db.app, {
      role: 'external_auditor',
      siteIds: [SITE_A],
      email: 'auditor@auth.test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      recordsFrom: '2020-01-01',
      recordsTo: '2020-12-31',
    });

    await grantCredential(stack, coordinator, auditor.accountId, PASSWORD);

    const { tokens } = await stack.auth.signIn({ email: auditor.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    expect(session.recordsFrom).toBe('2020-01-01');
    expect(session.recordsTo).toBe('2020-12-31');

    // Todo lo que existe hoy en el log ocurrió ahora, así que nada cae en 2020.
    const result = await stack.db.withSession(
      session,
      async (dbx) => dbx.execute(`SELECT id FROM audit_log` as never),
      { resource: 'audit_log' },
    );

    expect((result as unknown as { rows: unknown[] }).rows).toHaveLength(0);
  });

  it('su lectura queda registrada en la cadena, y la de otro rol no', async () => {
    const auditor = await createAccount(db.app, {
      role: 'external_auditor',
      siteIds: [SITE_A],
      email: 'auditor-logged@auth.test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      recordsFrom: '2026-01-01',
      recordsTo: '2030-12-31',
    });

    await grantCredential(stack, coordinator, auditor.accountId, PASSWORD);

    const { tokens } = await stack.auth.signIn({ email: auditor.email, password: PASSWORD });
    const session = await stack.sessions.resolve(tokens.accessToken);

    const before = await auditEntries(db.app, SITE_A, 'auditor.read');

    await stack.db.withSession(
      session,
      async (dbx) => dbx.execute(`SELECT id FROM person` as never),
      { resource: 'person' },
    );

    const after = await auditEntries(db.app, SITE_A, 'auditor.read');

    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)?.payload).toMatchObject({ resource: 'person' });
    expect(after.at(-1)?.actor_user_id).toBe(auditor.accountId);

    // La misma lectura hecha por el coordinador no escribe nada. Es la regla que la
    // excepción del auditor confirma: este sistema no loguea lecturas.
    const coordinatorSession = {
      userId: coordinator.userId,
      siteIds: [SITE_A],
      role: 'hs_coordinator',
    };

    await stack.db.withSession(
      coordinatorSession,
      async (dbx) => dbx.execute(`SELECT id FROM person` as never),
      { resource: 'person' },
    );

    const afterCoordinator = await auditEntries(db.app, SITE_A, 'auditor.read');
    expect(afterCoordinator.length).toBe(after.length);
  });
});

describe('ninguna ruta acepta un sitio, un alcance ni un actor', () => {
  /**
   * Tarea 6.8 del change. Lo que se prueba acá NO es que hoy no haya rutas de
   * escritura de dominio —no las hay, son de las etapas 4 a 6—: es que el contrato
   * que las va a recibir ya no tiene por dónde colar un alcance.
   */
  it('los contratos no tienen campo para un sitio, un alcance ni un actor', () => {
    const schemas = {
      signIn: signInRequestSchema,
      refresh: refreshRequestSchema,
      issueInvitation: issueInvitationRequestSchema,
      acceptInvitation: acceptInvitationRequestSchema,
      revokeSessions: revokeSessionsRequestSchema,
    };

    for (const [name, schema] of Object.entries(schemas)) {
      const keys = Object.keys(schema.shape);

      expect(keys, name).not.toContain('siteId');
      expect(keys, name).not.toContain('siteIds');
      expect(keys, name).not.toContain('siteScope');
      expect(keys, name).not.toContain('actorUserId');
      expect(keys, name).not.toContain('role');
    }
  });

  it('un sitio pasado en el cuerpo se descarta al parsear', () => {
    const parsed = signInRequestSchema.parse({
      email: 'someone@auth.test',
      password: 'whatever',
      siteId: SITE_B,
      role: 'hs_coordinator',
    });

    expect(parsed).not.toHaveProperty('siteId');
    expect(parsed).not.toHaveProperty('role');
  });

  it('un external_auditor no puede administrar ninguna cuenta', async () => {
    const auditor = await createAccount(db.app, {
      role: 'external_auditor',
      siteIds: [SITE_A],
      email: 'auditor-write@auth.test',
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      recordsFrom: '2026-01-01',
      recordsTo: '2026-06-30',
    });

    const victim = await account({ withCredential: false, email: 'auditor-victim@auth.test' });
    const actor = { userId: auditor.accountId, role: 'external_auditor' as const };

    // Los dos verbos administrativos que quedan con chequeo de rol EN EL SERVICIO. El
    // tercero era `twoFactor.reset`, y se fue con el segundo factor; los demás
    // —revocar sesiones, revocar una credencial— se gatean en el controlador, que este
    // spec no monta.
    expect(await codeOf(() => stack.invitations.issue(actor, victim.accountId))).toBe('forbidden');
    expect(await codeOf(() => stack.invitations.revoke(actor, victim.accountId))).toBe('forbidden');
  });
});

describe('la auditoría de la autenticación', () => {
  it('el login de una cuenta de dos plantas deja una entrada en cada cadena', async () => {
    const created = await account({
      siteIds: [SITE_A, SITE_B],
      email: 'two-sites@auth.test',
      role: 'jhsc_member',
    });

    const beforeA = await auditEntries(db.app, SITE_A, 'auth.signed_in');
    const beforeB = await auditEntries(db.app, SITE_B, 'auth.signed_in');

    await stack.auth.signIn({ email: created.email, password: PASSWORD });

    expect((await auditEntries(db.app, SITE_A, 'auth.signed_in')).length).toBe(beforeA.length + 1);
    expect((await auditEntries(db.app, SITE_B, 'auth.signed_in')).length).toBe(beforeB.length + 1);
  });

  it('el de una planta deja una sola', async () => {
    const created = await account({ siteIds: [SITE_A], email: 'one-site@auth.test' });

    const beforeA = await auditEntries(db.app, SITE_A, 'auth.signed_in');
    const beforeB = await auditEntries(db.app, SITE_B, 'auth.signed_in');

    await stack.auth.signIn({ email: created.email, password: PASSWORD });

    expect((await auditEntries(db.app, SITE_A, 'auth.signed_in')).length).toBe(beforeA.length + 1);
    expect((await auditEntries(db.app, SITE_B, 'auth.signed_in')).length).toBe(beforeB.length);
  });

  it('el fallo contra una cuenta real queda registrado, sin la contraseña', async () => {
    const created = await account({ email: 'failed-audit@auth.test' });

    const before = await auditEntries(db.app, SITE_A, 'auth.sign_in_failed');

    await codeOf(() =>
      stack.auth.signIn({ email: created.email, password: 'definitely-not-the-password' }),
    );

    const after = await auditEntries(db.app, SITE_A, 'auth.sign_in_failed');

    expect(after.length).toBe(before.length + 1);
    expect(after.at(-1)?.payload).toMatchObject({ reason: 'wrong_password' });
    expect(JSON.stringify(after.at(-1)?.payload)).not.toContain('definitely-not-the-password');
  });

  it('el fallo contra un email inexistente no escribe ninguna entrada', async () => {
    const beforeA = await auditEntries(db.app, SITE_A, 'auth.sign_in_failed');
    const beforeB = await auditEntries(db.app, SITE_B, 'auth.sign_in_failed');

    await codeOf(() => stack.auth.signIn({ email: 'ghost@auth.test', password: PASSWORD }));

    expect((await auditEntries(db.app, SITE_A, 'auth.sign_in_failed')).length).toBe(beforeA.length);
    expect((await auditEntries(db.app, SITE_B, 'auth.sign_in_failed')).length).toBe(beforeB.length);
  });

  it('la invitación y su aceptación quedan registradas con quién las hizo', async () => {
    const target = await account({ withCredential: false, email: 'audited-invite@auth.test' });

    const beforeIssued = await auditEntries(db.app, SITE_A, 'invitation.issued');
    const invitation = await stack.invitations.issue(coordinator, target.accountId);
    const afterIssued = await auditEntries(db.app, SITE_A, 'invitation.issued');

    expect(afterIssued.length).toBe(beforeIssued.length + 1);
    expect(afterIssued.at(-1)?.payload).toMatchObject({ account_id: target.accountId });

    const beforeAccepted = await auditEntries(db.app, SITE_A, 'invitation.accepted');
    await stack.invitations.accept(invitation.token, PASSWORD);

    expect((await auditEntries(db.app, SITE_A, 'invitation.accepted')).length).toBe(
      beforeAccepted.length + 1,
    );
    expect((await auditEntries(db.app, SITE_A, 'credential.created')).length).toBeGreaterThan(0);
  });

  it('la cadena de cada planta sigue íntegra después de todo esto', async () => {
    for (const siteId of [SITE_A, SITE_B]) {
      const broken = await inScope(
        db.app,
        [siteId],
        'SELECT * FROM hs_audit_verify_chain($1::uuid)',
        [siteId],
      );

      expect(broken).toEqual([]);
    }
  });
});
