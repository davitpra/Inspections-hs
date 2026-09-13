import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAccountRequestSchema, type CreateAccountRequest } from '@hs/contracts';

import { AccountException } from '../src/auth/account.errors';
import { AccountService } from '../src/auth/account.service';
import { registerSite } from './helpers/catalog';
import { auditEntries, createAuthStack, grantCredential, type AuthStack } from './helpers/auth';
import { createAccount, createPerson } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * `POST /accounts` (proposal, design D3/D4) — el alta de una cuenta sale por HTTP por
 * primera vez. Lo que este spec protege son las dos propiedades que el riesgo de la
 * proposal nombra por su nombre:
 *
 *   - El permiso no se escribe dos veces: el rol lo comprueba el servicio, el alcance lo
 *     comprueba el motor (HS002), y el caso que el comando nunca tuvo —un coordinador de
 *     una planta administrando la otra— tiene que frenar sin dejar ninguna fila.
 *   - La auditoría no se pierde en silencio: la entrada existe en la cadena de la planta
 *     DESPUÉS del COMMIT, no porque la llamada haya devuelto sin lanzar.
 */

const SITE_A = 'accc0000-0000-4000-8000-000000000001';
const SITE_B = 'accc0000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: AuthStack;
let accounts: AccountService;

let coordinatorId: string;
let narrowId: string;

const asCoordinator = () => ({
  userId: coordinatorId,
  role: 'coordinator' as const,
  siteIds: [SITE_A, SITE_B],
});
const asNarrowCoordinator = () => ({
  userId: narrowId,
  role: 'coordinator' as const,
  siteIds: [SITE_A],
});

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createAuthStack(db.appUrl);
  accounts = new AccountService(stack.db, stack.invitations, stack.sessions);

  await registerSite(db.migrator, SITE_A, 'account-a', 'Account A');
  await registerSite(db.migrator, SITE_B, 'account-b', 'Account B');

  const coordinator = await createAccount(db.app, {
    role: 'coordinator',
    siteIds: [SITE_A, SITE_B],
  });
  coordinatorId = coordinator.accountId;

  const narrow = await createAccount(db.app, { role: 'coordinator', siteIds: [SITE_A] });
  narrowId = narrow.accountId;
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

/** El código de un `AccountException`, que es lo que el cliente lee. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AccountException) return error.code;
    throw error;
  }

  throw new Error('Se esperaba un error de alta y no hubo ninguno.');
}

let counter = 0;
function email(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}@account-creation.test`;
}

/** Un pedido de alta, parseado por el mismo esquema que el controller usa. */
function request(overrides: {
  personId: string;
  email: string;
  role?: string;
  siteIds: readonly string[];
  invite?: boolean;
}): CreateAccountRequest {
  return createAccountRequestSchema.parse({
    person_id: overrides.personId,
    email: overrides.email,
    role: overrides.role ?? 'inspector',
    site_ids: overrides.siteIds,
    invite: overrides.invite ?? false,
  });
}

describe('el alta escribe app_user, user_site_scope y su auditoría', () => {
  it('crea la cuenta sin credencial y la entrada existe en la cadena después del COMMIT', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'Nueva' });

    const result = await accounts.create(
      asCoordinator(),
      request({ personId: person, email: email('nueva'), siteIds: [SITE_A] }),
    );

    expect(result.account.role).toBe('inspector');
    expect(result.account.active).toBe(true);
    expect(result.account.can_sign_in).toBe(false);
    expect(result.invitation).toBeUndefined();

    expect(await stack.credentials.hasActive(result.account.id)).toBe(false);

    const entries = await auditEntries(db.app, SITE_A, 'user.created');
    expect(entries.some((entry) => entry.payload['account_id'] === result.account.id)).toBe(true);
  });
});

describe('el permiso no se escribe dos veces (design D3)', () => {
  it('un miembro del JHSC no puede crear una cuenta, y no crea nada', async () => {
    for (const role of ['inspector']) {
      const person = await createPerson(db.app, SITE_A, { lastName: `Rechazado-${role}` });

      const code = await codeOf(() =>
        accounts.create(
          { userId: coordinatorId, role: role as never },
          request({ personId: person, email: email('rechazado'), siteIds: [SITE_A] }),
        ),
      );

      expect(code).toBe('account_forbidden');

      const rows = await inScope(db.app, [SITE_A], 'SELECT id FROM app_user WHERE person_id = $1', [
        person,
      ]);
      expect(rows).toEqual([]);
    }
  });

  it('el coordinador de una planta administrando la otra es frenado y no deja ninguna fila', async () => {
    const person = await createPerson(db.app, SITE_B, { lastName: 'FueraDeAlcance' });

    await expect(
      accounts.create(
        asNarrowCoordinator(),
        request({ personId: person, email: email('fuera'), siteIds: [SITE_B] }),
      ),
    ).rejects.toBeTruthy();

    const rows = await inScope(db.app, [SITE_B], 'SELECT id FROM app_user WHERE person_id = $1', [
      person,
    ]);
    expect(rows).toEqual([]);
  });
});

describe('los otros dos rechazos del alta', () => {
  it('una segunda cuenta para la misma persona se rechaza', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'DosVeces' });

    await accounts.create(
      asCoordinator(),
      request({ personId: person, email: email('primera'), siteIds: [SITE_A] }),
    );

    const code = await codeOf(() =>
      accounts.create(
        asCoordinator(),
        request({ personId: person, email: email('segunda'), siteIds: [SITE_A] }),
      ),
    );

    expect(code).toBe('account_already_exists');
  });

  it('un email que ya es de otra cuenta se rechaza', async () => {
    const existing = await createAccount(db.app, { role: 'management', siteIds: [SITE_A] });
    const person = await createPerson(db.app, SITE_A, { lastName: 'EmailTomado' });

    const code = await codeOf(() =>
      accounts.create(
        asCoordinator(),
        request({ personId: person, email: existing.email, siteIds: [SITE_A] }),
      ),
    );

    expect(code).toBe('account_email_taken');
  });
});

describe('invitar en el mismo acto (invite: true, design D4)', () => {
  it('el alta y la invitación comparten transacción: la cuenta nace ya invitada', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'Invitada' });

    const result = await accounts.create(
      asCoordinator(),
      request({ personId: person, email: email('invitada'), siteIds: [SITE_A], invite: true }),
    );

    expect(result.invitation?.token).toBeTruthy();

    const rows = await inScope<{ id: string }>(
      db.app,
      [SITE_A],
      'SELECT id FROM user_invitation WHERE user_id = $1',
      [result.account.id],
    );
    expect(rows.length).toBe(1);
  });
});

describe('GET /accounts/:id — el detalle de una cuenta (design D6)', () => {
  const asCoordinatorSession = () => ({
    userId: coordinatorId,
    siteIds: [SITE_A, SITE_B],
    role: 'coordinator' as const,
  });

  it('el coordinador lee una cuenta de su alcance, con su email', async () => {
    const created = await createAccount(db.app, {
      role: 'inspector',
      siteIds: [SITE_A],
      lastName: 'Detalle',
    });

    const detail = await accounts.find(asCoordinatorSession(), created.accountId);

    expect(detail.email).toBe(created.email);
    expect(detail.can_sign_in).toBe(false);
  });

  it('una cuenta fuera del alcance no se lee', async () => {
    const created = await createAccount(db.app, { role: 'inspector', siteIds: [SITE_B] });

    const narrowSession = { userId: narrowId, siteIds: [SITE_A], role: 'coordinator' as const };
    const code = await codeOf(() => accounts.find(narrowSession, created.accountId));

    expect(code).toBe('account_not_found');
  });

  it('ningún otro rol lee el detalle de una cuenta', async () => {
    const created = await createAccount(db.app, { role: 'inspector', siteIds: [SITE_A] });
    const session = { userId: coordinatorId, siteIds: [SITE_A, SITE_B], role: 'inspector' as const };

    const code = await codeOf(() => accounts.find(session, created.accountId));

    expect(code).toBe('account_forbidden');
  });
});

describe('PATCH /accounts/:id — reemitir y corregir el correo (design D5)', () => {
  it('corrige el email, revoca la invitación pendiente y audita el cambio', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'CorreoMalo' });
    const typoEmail = email('typo');
    const created = await accounts.create(
      asCoordinator(),
      request({ personId: person, email: typoEmail, siteIds: [SITE_A], invite: true }),
    );
    const oldToken = created.invitation!.token;
    const newEmail = email('corregido');

    const result = await accounts.update(asCoordinator(), created.account.id, {
      email: newEmail,
      invite: true,
    });

    expect(result.invitation?.token).toBeTruthy();
    expect(result.invitation?.token).not.toBe(oldToken);

    const rows = await inScope<{ email: string }>(
      db.app,
      [SITE_A],
      'SELECT email FROM app_user WHERE id = $1',
      [created.account.id],
    );
    expect(one(rows).email).toBe(newEmail);

    const invitations = await inScope<{ revoked_at: Date | null; accepted_at: Date | null }>(
      db.app,
      [SITE_A],
      'SELECT revoked_at, accepted_at FROM user_invitation WHERE user_id = $1 ORDER BY issued_at',
      [created.account.id],
    );
    expect(invitations.length).toBe(2);
    expect(invitations[0]!.revoked_at).not.toBeNull();
    expect(invitations[1]!.revoked_at).toBeNull();

    const entries = await auditEntries(db.app, SITE_A, 'user.email_changed');
    const entry = entries.find((row) => row.payload['account_id'] === created.account.id);
    expect(entry?.payload['email']).toBe(newEmail);
    expect(entry?.payload['previous_email']).toBe(typoEmail);
  });

  it('un correo que ya es de otra cuenta se rechaza y no queda nada escrito', async () => {
    const taken = await createAccount(db.app, { role: 'inspector', siteIds: [SITE_A] });
    const person = await createPerson(db.app, SITE_A, { lastName: 'CorreoTomado' });
    const created = await accounts.create(
      asCoordinator(),
      request({ personId: person, email: email('propio'), siteIds: [SITE_A], invite: true }),
    );

    const code = await codeOf(() =>
      accounts.update(asCoordinator(), created.account.id, {
        email: taken.email,
        invite: true,
      }),
    );

    expect(code).toBe('account_email_taken');

    const rows = await inScope<{ email: string }>(
      db.app,
      [SITE_A],
      'SELECT email FROM app_user WHERE id = $1',
      [created.account.id],
    );
    expect(one(rows).email).not.toBe(taken.email);

    const invitations = await inScope(
      db.app,
      [SITE_A],
      'SELECT id FROM user_invitation WHERE user_id = $1',
      [created.account.id],
    );
    expect(invitations.length).toBe(1);
  });

  it('una cuenta que ya puede entrar rechaza reemitir y corregir el correo', async () => {
    const created = await createAccount(db.app, { role: 'inspector', siteIds: [SITE_A] });
    await grantCredential(stack, asCoordinator(), created.accountId, 'a-long-enough-password');

    const code = await codeOf(() =>
      accounts.update(asCoordinator(), created.accountId, {
        email: email('nuevo'),
        invite: true,
      }),
    );

    expect(code).toBe('account_already_active');

    const rows = await inScope<{ email: string }>(
      db.app,
      [SITE_A],
      'SELECT email FROM app_user WHERE id = $1',
      [created.accountId],
    );
    expect(one(rows).email).toBe(created.email);
  });

  it('reemitir sin corregir el correo lo deja intacto', async () => {
    const person = await createPerson(db.app, SITE_A, { lastName: 'SinCorregir' });
    const originalEmail = email('sin-cambio');
    const created = await accounts.create(
      asCoordinator(),
      request({ personId: person, email: originalEmail, siteIds: [SITE_A], invite: true }),
    );

    await accounts.update(asCoordinator(), created.account.id, { invite: true });

    const rows = await inScope<{ email: string }>(
      db.app,
      [SITE_A],
      'SELECT email FROM app_user WHERE id = $1',
      [created.account.id],
    );
    expect(one(rows).email).toBe(originalEmail);
  });
});
