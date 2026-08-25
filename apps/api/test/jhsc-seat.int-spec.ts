import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { updateAccountRequestSchema, type UpdateAccountRequest } from '@hs/contracts';

import { AccountException } from '../src/auth/account.errors';
import { AccountService } from '../src/auth/account.service';
import { registerSite } from './helpers/catalog';
import { auditEntries, createAuthStack, grantCredential, type AuthStack } from './helpers/auth';
import { createAccount } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * `PATCH /accounts/:id` con `jhsc_seat` (`coordinator-jhsc-seat`) — sentar a una cuenta de
 * coordinador en el JHSC, y levantarla.
 *
 * Lo que este spec protege es lo que ningún test unitario ve:
 *
 *   - **El `CHECK` del motor**, que es la garantía de que el asiento no se vuelve una
 *     segunda puerta para volver inspeccionable a un rol que §4 no pone en el comité. La
 *     guarda del servicio da el mensaje; la que no se puede saltear con un INSERT a mano
 *     es esta.
 *   - **El rastro en la cadena de CADA planta del alcance**, firmado por quien lo hizo. Es
 *     el acto que la coordinadora se aplica a sí misma, así que es justo el que un
 *     inspector del MLITSD querría poder leer.
 *   - **Que el asiento no toca el acceso.** Sentarse y levantarse no revocan credencial ni
 *     sesión: si algún día alguien copia el final de `withdraw()` acá, este spec cae.
 */

const SITE_A = 'bddd0000-0000-4000-8000-000000000001';
const SITE_B = 'bddd0000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: AuthStack;
let accounts: AccountService;

let coordinatorId: string;

const asCoordinator = () => ({ userId: coordinatorId, role: 'hs_coordinator' as const });

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createAuthStack(db.appUrl);
  accounts = new AccountService(stack.db, stack.invitations, stack.sessions);

  await registerSite(db.migrator, SITE_A, 'seat-a', 'Seat A');
  await registerSite(db.migrator, SITE_B, 'seat-b', 'Seat B');

  const coordinator = await createAccount(db.app, {
    role: 'hs_coordinator',
    siteIds: [SITE_A, SITE_B],
  });
  coordinatorId = coordinator.accountId;
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

async function seatOf(accountId: string): Promise<Date | null> {
  const rows = await inScope<{ jhsc_seat_granted_at: Date | null }>(
    db.app,
    [SITE_A, SITE_B],
    'SELECT jhsc_seat_granted_at FROM app_user WHERE id = $1',
    [accountId],
  );

  return one(rows).jhsc_seat_granted_at;
}

describe('el motor decide quién puede ocupar un asiento', () => {
  it('rechaza el asiento sobre cualquier rol que no sea hs_coordinator', async () => {
    for (const role of ['jhsc_member', 'supervisor', 'management'] as const) {
      await expect(
        createAccount(db.app, { role, siteIds: [SITE_A], jhscSeat: true }),
      ).rejects.toThrow(/app_user_jhsc_seat_check/);
    }
  });

  it('acepta el asiento sobre una cuenta de coordinador', async () => {
    const seated = await createAccount(db.app, {
      role: 'hs_coordinator',
      siteIds: [SITE_A],
      jhscSeat: true,
    });

    expect(await seatOf(seated.accountId)).not.toBeNull();
  });

  it('una cuenta de coordinador nace sin asiento', async () => {
    const plain = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A] });

    expect(await seatOf(plain.accountId)).toBeNull();
  });
});

describe('sentarse y levantarse dejan rastro donde el registro lo necesita', () => {
  it('escribe user.jhsc_seat_granted en la cadena de CADA planta, firmada por la actora', async () => {
    const target = await createAccount(db.app, {
      role: 'hs_coordinator',
      siteIds: [SITE_A, SITE_B],
    });

    await accounts.update(asCoordinator(), target.accountId, request({ jhsc_seat: true }));

    for (const site of [SITE_A, SITE_B]) {
      const entries = await auditEntries(db.app, site, 'user.jhsc_seat_granted');
      const mine = entries.filter((entry) => entry.payload['account_id'] === target.accountId);

      expect(mine).toHaveLength(1);
      expect(one(mine).actor_user_id).toBe(coordinatorId);
    }
  });

  it('levantarse es un evento propio, no la ausencia del anterior', async () => {
    const target = await createAccount(db.app, {
      role: 'hs_coordinator',
      siteIds: [SITE_A],
      jhscSeat: true,
    });

    await accounts.update(asCoordinator(), target.accountId, request({ jhsc_seat: false }));

    const entries = await auditEntries(db.app, SITE_A, 'user.jhsc_seat_withdrawn');
    const mine = entries.filter((entry) => entry.payload['account_id'] === target.accountId);

    expect(mine).toHaveLength(1);
    expect(await seatOf(target.accountId)).toBeNull();
  });

  /**
   * La coordinadora se sienta sola, y la entrada dice exactamente eso: no hay otro rol a
   * quien pedírselo, y lo que lo vuelve revisable es la firma.
   */
  it('la coordinadora puede sentarse a sí misma', async () => {
    const own = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A] });
    const herself = { userId: own.accountId, role: 'hs_coordinator' as const };

    const result = await accounts.update(herself, own.accountId, request({ jhsc_seat: true }));

    expect(result.account.jhsc_seat).toBe(true);

    const entries = await auditEntries(db.app, SITE_A, 'user.jhsc_seat_granted');
    const mine = entries.filter((entry) => entry.payload['account_id'] === own.accountId);

    expect(one(mine).actor_user_id).toBe(own.accountId);
  });

  /**
   * Sentarse dos veces no corre la fecha: `jhsc_seat_granted_at` tiene que seguir siendo el
   * momento en que la cuenta se sentó de verdad.
   */
  it('pedir el asiento que ya se tiene no reescribe el momento', async () => {
    const target = await createAccount(db.app, {
      role: 'hs_coordinator',
      siteIds: [SITE_A],
      jhscSeat: true,
    });
    const before = await seatOf(target.accountId);

    await accounts.update(asCoordinator(), target.accountId, request({ jhsc_seat: true }));

    expect(await seatOf(target.accountId)).toEqual(before);
  });
});

describe('el asiento no es acceso', () => {
  it('no revoca la credencial ni las sesiones de quien se sienta y se levanta', async () => {
    const target = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A] });
    await grantCredential(stack, asCoordinator(), target.accountId, 'una-contrasena-larga');

    const email = one(
      await inScope<{ email: string }>(
        db.app,
        [SITE_A],
        'SELECT email FROM app_user WHERE id = $1',
        [target.accountId],
      ),
    ).email;

    await stack.auth.signIn({ email, password: 'una-contrasena-larga' });

    await accounts.update(asCoordinator(), target.accountId, request({ jhsc_seat: true }));
    await accounts.update(asCoordinator(), target.accountId, request({ jhsc_seat: false }));

    expect(await stack.credentials.hasActive(target.accountId)).toBe(true);

    const live = await inScope(
      db.app,
      [SITE_A],
      'SELECT id FROM app_session WHERE user_id = $1 AND revoked_at IS NULL',
      [target.accountId],
    );

    expect(live.length).toBeGreaterThan(0);
  });
});

describe('lo que el servicio rechaza antes de llegar al motor', () => {
  it('un rol que no puede sentarse recibe un conflicto legible, no un 23514', async () => {
    const member = await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_A] });

    const code = await codeOf(() =>
      accounts.update(asCoordinator(), member.accountId, request({ jhsc_seat: true })),
    );

    expect(code).toBe('account_role_without_jhsc_seat');
    expect(await seatOf(member.accountId)).toBeNull();
  });

  it('una cuenta sin acceso no se sienta en el comité', async () => {
    const target = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A] });
    await inScope(
      db.app,
      [SITE_A],
      'UPDATE app_user SET deactivated_at = now() WHERE id = $1',
      [target.accountId],
    );

    const code = await codeOf(() =>
      accounts.update(asCoordinator(), target.accountId, request({ jhsc_seat: true })),
    );

    expect(code).toBe('account_already_inactive');
  });

  it('solo el coordinador administra el asiento', async () => {
    const target = await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A] });
    const member = await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_A] });

    const code = await codeOf(() =>
      accounts.update(
        { userId: member.accountId, role: 'jhsc_member' },
        target.accountId,
        request({ jhsc_seat: true }),
      ),
    );

    expect(code).toBe('account_forbidden');
  });
});
