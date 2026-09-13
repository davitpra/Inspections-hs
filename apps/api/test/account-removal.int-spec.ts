import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createAccountRequestSchema,
  updateAccountRequestSchema,
  type CreateAccountRequest,
  type UpdateAccountRequest,
} from '@hs/contracts';

import { AccountException } from '../src/auth/account.errors';
import { AccountService } from '../src/auth/account.service';
import { registerSite } from './helpers/catalog';
import { auditEntries, createAuthStack, grantCredential, type AuthStack } from './helpers/auth';
import { createAccount } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * `PATCH /accounts/:id` con `deactivated` (`remove-jhsc-access-from-roster`) — quitar el
 * acceso al JHSC y devolverlo.
 *
 * Lo que este spec protege son las dos propiedades que ningún test unitario puede ver,
 * porque las dos viven en el orden de las transacciones y no en el código del servicio:
 *
 *   - **La baja deja rastro en la cadena de CADA planta que la cuenta alcanzaba.** El
 *     fanout de auditoría está diferido a COMMIT y lee `user_site_scope` vigente; si
 *     alguien "ordena" la baja revocando también el alcance, este spec cae y ahí se
 *     entera, en vez de descubrirlo cuando un inspector del MLITSD pregunte cuándo
 *     terminó el acceso de alguien.
 *   - **La entrada nombra al COORDINADOR.** La revocación de sesiones declara el alcance
 *     de la cuenta administrada, así que corriendo dentro de la transacción equivocada la
 *     auditoría diría que la persona removida se removió a sí misma — y la comprobación
 *     de permisos HS002 se evaluaría contra el alcance del objetivo.
 */

const SITE_A = 'bccc0000-0000-4000-8000-000000000001';
const SITE_B = 'bccc0000-0000-4000-8000-000000000002';

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

  await registerSite(db.migrator, SITE_A, 'removal-a', 'Removal A');
  await registerSite(db.migrator, SITE_B, 'removal-b', 'Removal B');

  const coordinator = await createAccount(db.app, {
    role: 'coordinator',
    siteIds: [SITE_A, SITE_B],
  });
  coordinatorId = coordinator.accountId;

  const narrow = await createAccount(db.app, { role: 'coordinator', siteIds: [SITE_B] });
  narrowId = narrow.accountId;
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

/** El pedido, parseado por el mismo esquema que el controller usa. */
function request(body: unknown): UpdateAccountRequest {
  return updateAccountRequestSchema.parse(body);
}

/** El código de un `AccountException`, que es lo que el cliente lee. */
async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AccountException) return error.code;
    throw error;
  }

  throw new Error('Se esperaba un error y no hubo ninguno.');
}

/** Un miembro del JHSC, con el alcance que se le pida. */
async function seedMember(siteIds: readonly string[]): Promise<string> {
  const member = await createAccount(db.app, { role: 'inspector', siteIds });

  return member.accountId;
}

/** La persona de una cuenta, que es lo que `POST /accounts` recibe. */
async function personOf(accountId: string): Promise<string> {
  const rows = await inScope<{ person_id: string }>(
    db.app,
    [SITE_A, SITE_B],
    'SELECT person_id FROM app_user WHERE id = $1',
    [accountId],
  );

  return one(rows).person_id;
}

let counter = 0;
function email(prefix: string): string {
  counter += 1;
  return `${prefix}-${counter}@account-removal.test`;
}

/** Un alta, parseada por el mismo esquema que el controller usa. */
function newAccount(overrides: {
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

async function accountRow(
  accountId: string,
): Promise<{ deactivated_at: Date | null; active: boolean }> {
  const rows = await inScope<{ deactivated_at: Date | null; active: boolean }>(
    db.app,
    [SITE_A, SITE_B],
    `SELECT deactivated_at, hs_account_is_active(app_user.*) AS active
       FROM app_user WHERE id = $1`,
    [accountId],
  );

  return one(rows);
}

describe('la baja deja rastro donde el registro lo necesita', () => {
  it('escribe user.deactivated en la cadena de CADA planta del alcance, firmada por el coordinador', async () => {
    const member = await seedMember([SITE_A, SITE_B]);

    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    for (const site of [SITE_A, SITE_B]) {
      const entries = await auditEntries(db.app, site, 'user.deactivated');
      const mine = entries.filter((entry) => entry.payload['account_id'] === member);

      expect(mine).toHaveLength(1);
      // T2: si la revocación de sesiones corriera dentro de la transacción de la baja,
      // `app.user_id` quedaría pisado con el objetivo y esta línea diría `member`.
      expect(one(mine).actor_user_id).toBe(coordinatorId);
    }
  });

  /**
   * T1 — el alcance sobrevive a la baja. No es un olvido: revocarlo en la misma
   * transacción dejaría el fanout de arriba sin ninguna planta a la que escribir.
   */
  it('no revoca user_site_scope: sin alcance vigente no habría cadena donde anotar la baja', async () => {
    const member = await seedMember([SITE_A, SITE_B]);

    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    const scope = await inScope<{ site_id: string }>(
      db.app,
      [SITE_A, SITE_B],
      `SELECT site_id FROM user_site_scope
        WHERE user_id = $1 AND revoked_at IS NULL ORDER BY site_id`,
      [member],
    );

    expect(scope.map((row) => row.site_id).sort()).toEqual([SITE_A, SITE_B].sort());
  });

  it('el alcance intacto no da acceso: la cuenta queda inactiva igual', async () => {
    const member = await seedMember([SITE_A]);

    const result = await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    expect(result.account.active).toBe(false);
    expect(result.account.can_sign_in).toBe(false);

    const row = await accountRow(member);
    expect(row.deactivated_at).not.toBeNull();
    expect(row.active).toBe(false);
  });
});

describe('quitar el acceso es un solo acto para los dos casos', () => {
  it('cancela la invitación pendiente que nadie aceptó', async () => {
    const member = await seedMember([SITE_A]);
    const invitation = await stack.invitations.issue(asCoordinator(), member);

    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    const rows = await inScope<{ revoked_at: Date | null }>(
      db.app,
      [SITE_A],
      'SELECT revoked_at FROM user_invitation WHERE id = $1',
      [invitation.invitationId],
    );

    expect(one(rows).revoked_at).not.toBeNull();

    // Y el token que estaba en el correo de alguien deja de servir.
    await expect(stack.invitations.accept(invitation.token, 'una-contrasena-larga')).rejects.toThrow();
  });

  it('revoca la credencial y las sesiones de un miembro que ya entraba', async () => {
    const member = await seedMember([SITE_A]);
    await grantCredential(stack, asCoordinator(), member, 'una-contrasena-larga');

    const email = one(
      await inScope<{ email: string }>(db.app, [SITE_A], 'SELECT email FROM app_user WHERE id = $1', [
        member,
      ]),
    ).email;

    await stack.auth.signIn({ email, password: 'una-contrasena-larga' });

    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    expect(await stack.credentials.hasActive(member)).toBe(false);

    const live = await inScope(
      db.app,
      [SITE_A],
      'SELECT id FROM app_session WHERE user_id = $1 AND revoked_at IS NULL',
      [member],
    );
    expect(live).toEqual([]);

    // Y no puede volver a entrar con la contraseña que tenía.
    await expect(stack.auth.signIn({ email, password: 'una-contrasena-larga' })).rejects.toThrow();
  });
});

describe('el permiso de la baja', () => {
  it('un miembro del JHSC no puede quitar el acceso de otra cuenta', async () => {
    const member = await seedMember([SITE_A]);

    for (const role of ['inspector']) {
      const code = await codeOf(() =>
        accounts.update(
          { userId: coordinatorId, role: role as never, siteIds: [SITE_A, SITE_B] },
          member,
          request({ deactivated: true }),
        ),
      );

      expect(code).toBe('account_forbidden');
    }

    expect((await accountRow(member)).active).toBe(true);
  });

  /**
   * El coordinador de la otra planta no ve la `person` de la que cuelga la cuenta —la
   * política de `person` filtra sola—, así que la lectura previa ya no la encuentra. Ese
   * es el mismo aislamiento que `findAccountDetail` documenta, y por eso el error es
   * "no existe" y no uno que confirme que existe en otro lado.
   */
  it('un coordinador que no alcanza la planta de la cuenta no la puede dar de baja', async () => {
    const member = await seedMember([SITE_A]);

    const code = await codeOf(() =>
      accounts.update(asNarrowCoordinator(), member, request({ deactivated: true })),
    );

    expect(code).toBe('account_not_found');
    expect((await accountRow(member)).active).toBe(true);
  });

  it('solo se da de baja un inspector: el roster no administra otros roles', async () => {
    for (const role of ['management', 'coordinator'] as const) {
      const other = await createAccount(db.app, { role, siteIds: [SITE_A] });

      const code = await codeOf(() =>
        accounts.update(asCoordinator(), other.accountId, request({ deactivated: true })),
      );

      expect(code).toBe('account_role_not_removable');
      expect((await accountRow(other.accountId)).active).toBe(true);
    }
  });

  it('dar de baja dos veces se rechaza: la segunda pisaría la fecha en que el acceso terminó', async () => {
    const member = await seedMember([SITE_A]);

    await accounts.update(asCoordinator(), member, request({ deactivated: true }));
    const first = (await accountRow(member)).deactivated_at;

    const code = await codeOf(() =>
      accounts.update(asCoordinator(), member, request({ deactivated: true })),
    );

    expect(code).toBe('account_already_inactive');
    expect((await accountRow(member)).deactivated_at).toEqual(first);
  });
});

/**
 * Volver a darle acceso a alguien es INVITARLO, y eso es `POST /accounts`. No hay un acto
 * de "restituir": el llamador pide un alta y el servidor decide si eso es insertar o
 * revivir la fila que la persona ya tenía. Estos tests fijan que revivir conserva lo que
 * tiene que conservar, porque desde afuera no se ve la diferencia.
 */
describe('volver a invitar revive la cuenta que la persona ya tenía', () => {
  it('acepta el mismo correo que la cuenta tenía antes de la baja', async () => {
    const member = await seedMember([SITE_A]);
    const personId = await personOf(member);
    const rows = await inScope<{ email: string }>(
      db.app,
      [SITE_A],
      'SELECT email FROM app_user WHERE id = $1',
      [member],
    );
    const originalEmail = one(rows).email;
    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    const result = await accounts.create(
      asCoordinator(),
      newAccount({ personId, email: originalEmail, siteIds: [SITE_A], invite: true }),
    );

    expect(result.account.id).toBe(member);
    expect(result.account.email).toBe(originalEmail);
    expect(result.invitation?.token).toBeTruthy();
    expect((await accountRow(member)).deactivated_at).toBeNull();
  });

  it('devuelve LA MISMA cuenta —person_id es único— con su alcance y un link nuevo', async () => {
    const member = await seedMember([SITE_A, SITE_B]);
    const personId = await personOf(member);
    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    const result = await accounts.create(
      asCoordinator(),
      newAccount({ personId, email: email('revivida'), siteIds: [SITE_A, SITE_B], invite: true }),
    );

    expect(result.account.id).toBe(member);
    expect(result.account.active).toBe(true);
    expect(result.account.can_sign_in).toBe(false);
    expect(result.invitation?.token).toBeTruthy();

    expect((await accountRow(member)).deactivated_at).toBeNull();

    const scope = await inScope<{ site_id: string }>(
      db.app,
      [SITE_A, SITE_B],
      `SELECT site_id FROM user_site_scope
        WHERE user_id = $1 AND revoked_at IS NULL ORDER BY site_id`,
      [member],
    );
    expect(scope).toHaveLength(2);

    for (const site of [SITE_A, SITE_B]) {
      const entries = await auditEntries(db.app, site, 'user.reactivated');
      expect(entries.some((entry) => entry.payload['account_id'] === member)).toBe(true);
    }
  });

  it('el link nuevo sirve, y con él la persona vuelve a entrar', async () => {
    const member = await seedMember([SITE_A]);
    const personId = await personOf(member);
    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    const result = await accounts.create(
      asCoordinator(),
      newAccount({ personId, email: email('vuelve'), siteIds: [SITE_A], invite: true }),
    );

    await stack.invitations.accept(result.invitation!.token, 'otra-contrasena-larga');

    expect(await stack.credentials.hasActive(member)).toBe(true);
  });

  it('el correo del alta reemplaza al que la cuenta tenía', async () => {
    const member = await seedMember([SITE_A]);
    const personId = await personOf(member);
    await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    const corrected = email('corregido');
    await accounts.create(
      asCoordinator(),
      newAccount({ personId, email: corrected, siteIds: [SITE_A], invite: true }),
    );

    const rows = await inScope<{ email: string }>(
      db.app,
      [SITE_A],
      'SELECT email FROM app_user WHERE id = $1',
      [member],
    );

    expect(one(rows).email).toBe(corrected);
  });

  it('una cuenta que sigue ACTIVA no se revive: sigue siendo un conflicto', async () => {
    const member = await seedMember([SITE_A]);
    const personId = await personOf(member);

    const code = await codeOf(() =>
      accounts.create(
        asCoordinator(),
        newAccount({ personId, email: email('duplicada'), siteIds: [SITE_A] }),
      ),
    );

    expect(code).toBe('account_already_exists');
  });

  /**
   * Revivir como `inspector` una cuenta administrativa dada de baja le cambiaría el rol
   * sin que nadie lo haya pedido. La pantalla no produce este caso; la guarda protege a
   * quien llame la API a mano.
   */
  it('no revive con un rol distinto del que la cuenta tenía', async () => {
    const other = await createAccount(db.app, { role: 'management', siteIds: [SITE_A] });

    // La baja de una cuenta administrativa NO sale por la ruta —es lo que
    // `account_role_not_removable` protege—, así que el estado se arma por SQL con el
    // alcance declarado, que es lo que el fanout diferido necesita al COMMIT.
    await inScope(db.app, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      other.accountId,
    ]);

    const code = await codeOf(() =>
      accounts.create(
        asCoordinator(),
        newAccount({ personId: other.personId, email: email('rol-distinto'), siteIds: [SITE_A] }),
      ),
    );

    expect(code).toBe('account_already_exists');
    expect((await accountRow(other.accountId)).deactivated_at).not.toBeNull();
  });
});

describe('la reemisión sigue funcionando como antes', () => {
  /**
   * La guarda `can_sign_in` bajó de la ruta a los dos actos que la necesitan. Este test
   * fija que bajó y no desapareció: reemitirle el link a quien ya entra sigue siendo la
   * toma de control que el reinicio de contraseña se reserva.
   */
  it('reemitir el link de una cuenta que ya puede entrar se sigue rechazando', async () => {
    const member = await seedMember([SITE_A]);
    await grantCredential(stack, asCoordinator(), member, 'una-contrasena-larga');

    const code = await codeOf(() =>
      accounts.update(asCoordinator(), member, request({ invite: true })),
    );

    expect(code).toBe('account_already_active');
  });

  it('pero quitarle el acceso a esa misma cuenta sí se permite: es el caso principal', async () => {
    const member = await seedMember([SITE_A]);
    await grantCredential(stack, asCoordinator(), member, 'una-contrasena-larga');

    const result = await accounts.update(asCoordinator(), member, request({ deactivated: true }));

    expect(result.account.active).toBe(false);
  });
});
