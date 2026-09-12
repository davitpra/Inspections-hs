import { updateAccountRequestSchema } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccountException } from '../src/auth/account.errors';
import { AccountService } from '../src/auth/account.service';
import { registerSite } from './helpers/catalog';
import { auditEntries, createAuthStack, type AuthStack } from './helpers/auth';
import { createAccount } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

const SITE_A = 'accc1000-0000-4000-8000-000000000001';
const SITE_B = 'accc1000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: AuthStack;
let accounts: AccountService;
let managerId: string;
let coordinatorId: string;
let memberId: string;

const promotion = updateAccountRequestSchema.parse({ promote_to: 'hs_coordinator' });
const asManager = () => ({
  userId: managerId,
  role: 'management' as const,
  siteIds: [SITE_A, SITE_B],
});

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createAuthStack(db.appUrl);
  accounts = new AccountService(stack.db, stack.invitations, stack.sessions);

  await registerSite(db.migrator, SITE_A, 'promotion-a', 'Promotion A');
  await registerSite(db.migrator, SITE_B, 'promotion-b', 'Promotion B');

  managerId = (
    await createAccount(db.app, { role: 'management', siteIds: [SITE_A, SITE_B] })
  ).accountId;
  coordinatorId = (
    await createAccount(db.app, { role: 'hs_coordinator', siteIds: [SITE_A, SITE_B] })
  ).accountId;
  memberId = (
    await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_A, SITE_B] })
  ).accountId;
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

async function roleOf(accountId: string): Promise<string> {
  return one(
    await inScope<{ role: string }>(db.app, [], 'SELECT role FROM app_user WHERE id = $1', [
      accountId,
    ]),
  ).role;
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AccountException) return error.code;
    throw error;
  }

  throw new Error('Se esperaba que la promoción fuera rechazada.');
}

describe('promoción de una cuenta a hs_coordinator', () => {
  it('management promueve y el trigger audita ambos roles en cada sitio', async () => {
    const result = await accounts.update(asManager(), memberId, promotion);

    expect(result.account.role).toBe('hs_coordinator');
    expect(await roleOf(memberId)).toBe('hs_coordinator');

    for (const siteId of [SITE_A, SITE_B]) {
      const entries = await auditEntries(db.app, siteId, 'user.role_changed');
      const entry = entries.find((row) => row.payload['account_id'] === memberId);

      expect(entry?.actor_user_id).toBe(managerId);
      expect(entry?.payload['previous_role']).toBe('jhsc_member');
      expect(entry?.payload['role']).toBe('hs_coordinator');
    }
  });

  it('rechaza la promoción al coordinador y al miembro', async () => {
    const memberActor = await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_A] });

    for (const actor of [
      { userId: coordinatorId, role: 'hs_coordinator' as const, siteIds: [SITE_A, SITE_B] },
      { userId: memberActor.accountId, role: 'jhsc_member' as const, siteIds: [SITE_A] },
    ]) {
      const target = await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_A] });

      expect(await codeOf(() => accounts.update(actor, target.accountId, promotion))).toBe(
        actor.role === 'hs_coordinator' ? 'account_promotion_forbidden' : 'account_forbidden',
      );
      expect(await roleOf(target.accountId)).toBe('jhsc_member');
    }
  });

  it('rechaza un rol actual distinto y lo nombra en el mensaje', async () => {
    const target = await createAccount(db.app, { role: 'management', siteIds: [SITE_A] });

    await expect(accounts.update(asManager(), target.accountId, promotion)).rejects.toMatchObject({
      code: 'account_role_not_promotable',
      message: expect.stringContaining('management'),
    });
    expect(await roleOf(target.accountId)).toBe('management');
  });

  it('rechaza una cuenta inactiva', async () => {
    const target = await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_A] });
    await inScope(db.app, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      target.accountId,
    ]);

    expect(await codeOf(() => accounts.update(asManager(), target.accountId, promotion))).toBe(
      'account_promotion_inactive',
    );
    expect(await roleOf(target.accountId)).toBe('jhsc_member');
  });

  it('rechaza una cuenta fuera del alcance', async () => {
    const narrowManager = await createAccount(db.app, { role: 'management', siteIds: [SITE_A] });
    const target = await createAccount(db.app, { role: 'jhsc_member', siteIds: [SITE_B] });

    expect(
      await codeOf(() =>
        accounts.update(
          { userId: narrowManager.accountId, role: 'management', siteIds: [SITE_A] },
          target.accountId,
          promotion,
        ),
      ),
    ).toBe('account_out_of_scope');
    expect(await roleOf(target.accountId)).toBe('jhsc_member');
  });

  it('rechaza promover la propia cuenta', async () => {
    expect(await codeOf(() => accounts.update(asManager(), managerId, promotion))).toBe(
      'account_promotion_self',
    );
    expect(await roleOf(managerId)).toBe('management');
  });
});
