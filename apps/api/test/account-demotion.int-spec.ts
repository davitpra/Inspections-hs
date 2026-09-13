import { updateAccountRequestSchema } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AccountException } from '../src/auth/account.errors';
import { AccountService } from '../src/auth/account.service';
import { InspectionsService } from '../src/inspections/inspections.service';
import { RosterService } from '../src/roster/roster.service';
import { registerSite } from './helpers/catalog';
import { auditEntries, createAuthStack, grantCredential, type AuthStack } from './helpers/auth';
import { createAccount, type SeededAccount } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

const SITE_A = 'dacc1000-0000-4000-8000-000000000001';
const SITE_B = 'dacc1000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: AuthStack;
let accounts: AccountService;
let inspections: InspectionsService;
let roster: RosterService;
let manager: SeededAccount;
let templateId: string;
let templateVersionId: string;

const demotion = updateAccountRequestSchema.parse({ demote_to: 'inspector' });
const asManager = () => ({
  userId: manager.accountId,
  role: 'management' as const,
  siteIds: [SITE_A, SITE_B],
});

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createAuthStack(db.appUrl);
  accounts = new AccountService(stack.db, stack.invitations, stack.sessions);
  inspections = new InspectionsService(stack.db);
  roster = new RosterService(stack.db);

  await registerSite(db.migrator, SITE_A, 'demotion-a', 'Demotion A');
  await registerSite(db.migrator, SITE_B, 'demotion-b', 'Demotion B');

  manager = await createAccount(db.app, { role: 'management', siteIds: [SITE_A, SITE_B] });
  templateId = await createTemplate(db.migrator, 'demotion-template', 'Demotion inspection');
  await registerItems(db.migrator, templateId, ['demotion.guard']);
  templateVersionId = await publishVersion(db.migrator, templateId, 1, {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'demotion.guard',
            prompt: 'Is the guard in place?',
            position: 1,
            required: true,
            response_type: 'yes_no',
            fails_on: 'no',
          },
        ],
      },
    ],
  });
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

  throw new Error('Se esperaba que la degradación fuera rechazada.');
}

describe('degradación de una cuenta a inspector', () => {
  it('management degrada una cuenta de dos sitios y audita ambos roles en cada cadena', async () => {
    const target = await createAccount(db.app, {
      role: 'coordinator',
      siteIds: [SITE_A, SITE_B],
    });
    const scopeBefore = await inScope<{ site_id: string }>(
      db.app,
      [],
      'SELECT site_id FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL ORDER BY site_id',
      [target.accountId],
    );

    const result = await accounts.update(asManager(), target.accountId, demotion);

    expect(result.account.role).toBe('inspector');
    expect(await roleOf(target.accountId)).toBe('inspector');
    expect(
      await inScope<{ person_id: string; email: string }>(
        db.app,
        [],
        'SELECT person_id, email FROM app_user WHERE id = $1',
        [target.accountId],
      ),
    ).toEqual([{ person_id: target.personId, email: target.email }]);
    expect(
      await inScope<{ site_id: string }>(
        db.app,
        [],
        'SELECT site_id FROM user_site_scope WHERE user_id = $1 AND revoked_at IS NULL ORDER BY site_id',
        [target.accountId],
      ),
    ).toEqual(scopeBefore);

    for (const siteId of [SITE_A, SITE_B]) {
      const entries = await auditEntries(db.app, siteId, 'user.role_changed');
      const entry = entries.find((row) => row.payload['account_id'] === target.accountId);

      expect(entry?.actor_user_id).toBe(manager.accountId);
      expect(entry?.payload['previous_role']).toBe('coordinator');
      expect(entry?.payload['role']).toBe('inspector');
    }
  });

  it('conserva credencial y sesión, pero la siguiente lectura pierde administración', async () => {
    const target = await createAccount(db.app, {
      role: 'coordinator',
      siteIds: [SITE_A, SITE_B],
    });
    await grantCredential(stack, { userId: manager.accountId, role: 'management' }, target.accountId, 'Test-password-123!');
    const tokens = await stack.sessions.issue(target.accountId);
    const sessionRow = one(
      await inScope<{ id: string }>(db.app, [], 'SELECT id FROM app_session WHERE token = $1', [
        tokens.accessToken,
      ]),
    );

    await accounts.update(asManager(), target.accountId, demotion);

    expect(
      await inScope<{ revoked_at: Date | null }>(
        db.app,
        [],
        'SELECT revoked_at FROM app_credential WHERE user_id = $1 AND revoked_at IS NULL',
        [target.accountId],
      ),
    ).toHaveLength(1);
    expect(
      await inScope<{ revoked_at: Date | null }>(
        db.app,
        [],
        'SELECT revoked_at FROM app_session WHERE id = $1',
        [sessionRow.id],
      ),
    ).toEqual([{ revoked_at: null }]);

    const resolved = await stack.sessions.resolve(tokens.accessToken);
    expect(resolved.role).toBe('inspector');
    await expect(roster.list(resolved, { site_id: SITE_A, status: 'active' })).rejects.toMatchObject({
      code: 'roster_forbidden',
    });
  });

  it('mantiene a la cuenta degradada como candidata y acepta asignarla', async () => {
    const target = await createAccount(db.app, { role: 'coordinator', siteIds: [SITE_A] });
    const managerSession = { userId: manager.accountId, role: 'management', siteIds: [SITE_A] };

    await accounts.update(asManager(), target.accountId, demotion);

    expect((await inspections.listInspectorCandidates(managerSession, SITE_A)).map((row) => row.id)).toContain(
      target.accountId,
    );
    const scheduledId = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: '2036-01-01',
      templateId,
      templateVersionId,
      scheduledBy: manager.accountId,
    });

    const updated = await inspections.assignInspector(managerSession, scheduledId, target.accountId);
    expect(updated.inspector_id).toBe(target.accountId);
  });

  it('aplica las guardas de actor, rol actual, actividad, alcance y auto-degradación', async () => {
    const coordinator = await createAccount(db.app, { role: 'coordinator', siteIds: [SITE_A] });
    const coordinatorTarget = await createAccount(db.app, {
      role: 'coordinator',
      siteIds: [SITE_A],
    });
    const member = await createAccount(db.app, { role: 'inspector', siteIds: [SITE_A] });

    expect(
      await codeOf(() =>
        accounts.update(
          { userId: coordinator.accountId, role: 'coordinator', siteIds: [SITE_A] },
          coordinatorTarget.accountId,
          demotion,
        ),
      ),
    ).toBe('account_demotion_forbidden');
    expect(await roleOf(coordinatorTarget.accountId)).toBe('coordinator');
    expect(
      await codeOf(() =>
        accounts.update(
          { userId: member.accountId, role: 'inspector', siteIds: [SITE_A] },
          coordinator.accountId,
          demotion,
        ),
      ),
    ).toBe('account_forbidden');
    expect(await codeOf(() => accounts.update(asManager(), member.accountId, demotion))).toBe(
      'account_role_not_demotable',
    );

    const managementTarget = await createAccount(db.app, { role: 'management', siteIds: [SITE_A] });
    expect(await codeOf(() => accounts.update(asManager(), managementTarget.accountId, demotion))).toBe(
      'account_role_not_demotable',
    );

    const inactive = await createAccount(db.app, { role: 'coordinator', siteIds: [SITE_A] });
    await inScope(db.migrator, [SITE_A], 'UPDATE app_user SET deactivated_at = now() WHERE id = $1', [
      inactive.accountId,
    ]);
    expect(await codeOf(() => accounts.update(asManager(), inactive.accountId, demotion))).toBe(
      'account_demotion_inactive',
    );
    expect(await roleOf(inactive.accountId)).toBe('coordinator');

    const outside = await createAccount(db.app, { role: 'coordinator', siteIds: [SITE_B] });
    expect(
      await codeOf(() =>
        accounts.update(
          { userId: manager.accountId, role: 'management', siteIds: [SITE_A] },
          outside.accountId,
          demotion,
        ),
      ),
    ).toBe('account_out_of_scope');
    expect(await roleOf(outside.accountId)).toBe('coordinator');

    expect(await codeOf(() => accounts.update(asManager(), manager.accountId, demotion))).toBe(
      'account_demotion_self',
    );
    expect(await roleOf(manager.accountId)).toBe('management');
  });

  it('promover y degradar la misma cuenta deja dos cambios de rol por sitio', async () => {
    const target = await createAccount(db.app, { role: 'inspector', siteIds: [SITE_A, SITE_B] });

    await accounts.update(asManager(), target.accountId, updateAccountRequestSchema.parse({
      promote_to: 'coordinator',
    }));
    await accounts.update(asManager(), target.accountId, demotion);

    expect(await roleOf(target.accountId)).toBe('inspector');
    for (const siteId of [SITE_A, SITE_B]) {
      const entries = (await auditEntries(db.app, siteId, 'user.role_changed')).filter(
        (row) => row.payload['account_id'] === target.accountId,
      );

      expect(entries).toHaveLength(2);
      expect(entries.map((row) => [row.payload['previous_role'], row.payload['role']])).toEqual([
        ['inspector', 'coordinator'],
        ['coordinator', 'inspector'],
      ]);
    }
  });
});
