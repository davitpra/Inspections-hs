import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerSite } from './helpers/catalog';
import { inSession, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const COORDINATOR = '33333333-3333-4333-8333-333333333333';
const INSPECTOR = '44444444-4444-4444-8444-444444444444';
const COORDINATOR_PERSON = '55555555-5555-4555-8555-555555555555';
const INSPECTOR_PERSON = '66666666-6666-4666-8666-666666666666';
const LOCATION = '77777777-7777-4777-8777-777777777777';
const INCIDENT = '88888888-8888-4888-8888-888888888888';
const INCIDENT_EVENT = '99999999-9999-4999-8999-999999999998';
const FINDING = '99999999-9999-4999-8999-999999999999';
const FINDING_PHOTO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
const ACTION = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EVENT_OPEN = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVENT_PROGRESS = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const EVENT_DONE = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const EVENT_CLOSED = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EVIDENCE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const HISTORICAL_ESCALATION = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const HISTORICAL_ACTION = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb';

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0048_rename_roles.sql'),
  'utf8',
);

let db: TestDatabase;

async function prepareLegacySchema(): Promise<void> {
  const client = await db.migrator.connect();

  try {
    await client.query('BEGIN');
    await client.query(`
      ALTER TABLE app_user DROP CONSTRAINT app_user_role_check;
      ALTER TABLE app_user ADD CONSTRAINT app_user_role_check
        CHECK (role IN ('hs_coordinator', 'jhsc_member', 'management'));
      DROP TRIGGER corrective_action_escalation_level_current ON corrective_action_escalation;
      ALTER TABLE corrective_action_escalation DROP CONSTRAINT corrective_action_escalation_level_check;
      ALTER TABLE corrective_action_escalation ADD CONSTRAINT corrective_action_escalation_level_check
        CHECK (level IN ('hs_coordinator', 'management'));
    `);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  const superuser = await db.superuser.connect();

  try {
    // Las restricciones de FK no son parte de lo que se prueba aquí: esta fila representa
    // una escalada histórica de una acción que existía antes del fixture de este test.
    await superuser.query('ALTER TABLE corrective_action_escalation DISABLE TRIGGER ALL');
    await superuser.query(
      `INSERT INTO corrective_action_escalation
         (id, action_id, site_id, level, due_at, days_overdue)
       VALUES ($1, $2, $3, 'hs_coordinator', '2026-08-01T00:00:00Z', 4)`,
      [HISTORICAL_ESCALATION, HISTORICAL_ACTION, SITE_A],
    );
    await superuser.query('ALTER TABLE corrective_action_escalation ENABLE TRIGGER ALL');
  } finally {
    superuser.release();
  }
}

async function insertLegacyAccounts(client: PoolClient): Promise<void> {
  await client.query(`SELECT set_config('app.site_ids', $1, true)`, [`${SITE_A},${SITE_B}`]);
  await client.query(
    `INSERT INTO person (id, employee_number, first_name, last_name, site_id)
     VALUES
       ($1, 'M-1001', 'Ada', 'Coordinator', $3),
       ($2, 'M-1002', 'Ian', 'Inspector', $3)`,
    [COORDINATOR_PERSON, INSPECTOR_PERSON, SITE_A],
  );
  await client.query(
    `INSERT INTO app_user (id, person_id, email, role)
     VALUES
       ($1, $3, 'ada.coordinator@example.com', 'hs_coordinator'),
       ($2, $4, 'ian.inspector@example.com', 'jhsc_member')`,
    [COORDINATOR, INSPECTOR, COORDINATOR_PERSON, INSPECTOR_PERSON],
  );
  await client.query(
    `INSERT INTO user_site_scope (user_id, site_id)
     VALUES ($1, $3), ($1, $4), ($2, $3)`,
    [COORDINATOR, INSPECTOR, SITE_A, SITE_B],
  );
}

async function applyMigration(): Promise<void> {
  const client = await db.migrator.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.site_ids', $1, true)`, [`${SITE_A},${SITE_B}`]);
    await client.query(migration);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function insertPostMigrationFixtures(): Promise<void> {
  const client = await db.migrator.connect();

  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.site_ids', $1, true)`, [`${SITE_A},${SITE_B}`]);
    await client.query(`SELECT set_config('app.user_id', $1, true)`, [COORDINATOR]);
    await client.query(`SELECT set_config('app.role', 'coordinator', true)`);
    await client.query(
      `INSERT INTO location (id, site_id, code, name) VALUES ($1, $2, 'test-location', 'Test location')`,
      [LOCATION, SITE_A],
    );
    await client.query(
      `INSERT INTO incident (
         id, site_id, form_version, classification, subject_person_id, reported_by,
         occurred_at, reported_at, location_id, task_performed, equipment_involved,
         what_happened, body_part, on_site_treatment, immediate_action, narrative_language
       ) VALUES (
         $1, $2, 1, 'first_aid', $3, $4,
         '2026-08-20T10:00:00Z', '2026-08-20T11:00:00Z', $5,
         'Loading a test pallet', 'Test conveyor', 'A test incident was reported',
         'hand_or_finger', 'first_aid_on_site', 'Stopped the test activity', 'en'
       )`,
       [INCIDENT, SITE_A, INSPECTOR_PERSON, COORDINATOR, LOCATION],
    );
    await client.query(
      `INSERT INTO incident_event
         (id, incident_id, site_id, position, from_state, to_state, actor_user_id,
          occurred_at, recorded_at)
       VALUES ($1, $2, $3, 0, NULL, 'reported', $4,
         '2026-08-20T11:00:00Z', '2026-08-20T11:00:00Z')`,
       [INCIDENT_EVENT, INCIDENT, SITE_A, COORDINATOR],
    );
    await client.query(
      `INSERT INTO finding (
         id, site_id, origin, location_id, description, reported_by, occurred_at, recorded_at
       ) VALUES ($1, $2, 'manual', $3, 'A test finding for migration coverage', $4,
         '2026-08-20T10:00:00Z', '2026-08-20T11:00:00Z')`,
      [FINDING, SITE_A, LOCATION, INSPECTOR],
    );
    await client.query(
      `INSERT INTO finding_photo (id, finding_id, site_id, object_key)
       VALUES ($1, $2, $3, 'test/finding.jpg')`,
      [FINDING_PHOTO, FINDING, SITE_A],
    );
    await client.query(
      `INSERT INTO corrective_action (
         id, site_id, finding_id, assignee_person_id, description, due_at, created_by
       ) VALUES ($1, $2, $3, $4, 'Complete the migration test action',
         '2026-09-01T00:00:00Z', $5)`,
      [ACTION, SITE_A, FINDING, INSPECTOR_PERSON, INSPECTOR],
    );
    // Esta prueba aísla el verificador de roles; la derivación del estado del hallazgo tiene
    // su propia cobertura y no forma parte de la migración 0048.
    await client.query(
      'ALTER TABLE corrective_action_event DISABLE TRIGGER corrective_action_event_finding_state',
    );
    await client.query(
      `INSERT INTO corrective_action_event
       (id, action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
       VALUES
         ($1, $4, $5, 0, NULL, 'open', $6, '2026-08-20T12:00:00Z'),
         ($2, $4, $5, 1, 'open', 'in_progress', $6, '2026-08-20T13:00:00Z'),
         ($3, $4, $5, 2, 'in_progress', 'awaiting_verification', $6, '2026-08-20T14:00:00Z')`,
      [EVENT_OPEN, EVENT_PROGRESS, EVENT_DONE, ACTION, SITE_A, COORDINATOR],
    );
    await client.query(
      `INSERT INTO corrective_action_evidence
         (id, event_id, action_id, site_id, kind, object_key)
       VALUES ($1, $2, $3, $4, 'after', 'test/migration-after.jpg')`,
      [EVIDENCE, EVENT_DONE, ACTION, SITE_A],
    );
    await client.query(
      `INSERT INTO corrective_action_event
         (id, action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
       VALUES ($1, $2, $3, 3, 'awaiting_verification', 'closed', $4, '2026-08-20T15:00:00Z')`,
      [EVENT_CLOSED, ACTION, SITE_A, COORDINATOR],
    );
    await client.query(
      'ALTER TABLE corrective_action_event ENABLE TRIGGER corrective_action_event_finding_state',
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  db = await startTestDatabase();
  await registerSite(db.migrator, SITE_A, 'migration-a');
  await registerSite(db.migrator, SITE_B, 'migration-b');
  await prepareLegacySchema();

  const client = await db.migrator.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config(\'app.site_ids\', $1, true)', [`${SITE_A},${SITE_B}`]);
    await insertLegacyAccounts(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  await applyMigration();
  await insertPostMigrationFixtures();
}, 180_000);

afterAll(async () => {
  await db?.stop();
});

describe('migración 0048 de roles', () => {
  it('convierte las cuentas sin perder identidad, email ni alcance', async () => {
    const accounts = await db.superuser.query<{ id: string; email: string; role: string }>(
      `SELECT id, email, role FROM app_user WHERE id IN ($1, $2) ORDER BY id`,
      [COORDINATOR, INSPECTOR],
    );

    expect(accounts.rows).toEqual([
      { id: COORDINATOR, email: 'ada.coordinator@example.com', role: 'coordinator' },
      { id: INSPECTOR, email: 'ian.inspector@example.com', role: 'inspector' },
    ]);

    const scope = await db.superuser.query<{ user_id: string; site_id: string }>(
      `SELECT user_id, site_id FROM user_site_scope WHERE user_id IN ($1, $2) ORDER BY user_id, site_id`,
      [COORDINATOR, INSPECTOR],
    );

    expect(scope.rows).toEqual([
      { user_id: COORDINATOR, site_id: SITE_A },
      { user_id: COORDINATOR, site_id: SITE_B },
      { user_id: INSPECTOR, site_id: SITE_A },
    ]);
  });

  it('escribe un role_changed histórico por cada sitio alcanzado', async () => {
    const audit = await db.superuser.query<{
      site_id: string;
      previous_role: string;
      role: string;
    }>(
      `SELECT site_id, payload->>'previous_role' AS previous_role, payload->>'role' AS role
         FROM audit_log
        WHERE event_type = 'user.role_changed' AND payload->>'account_id' = $1
        ORDER BY site_id`,
      [COORDINATOR],
    );

    expect(audit.rows).toEqual([
      { site_id: SITE_A, previous_role: 'hs_coordinator', role: 'coordinator' },
      { site_id: SITE_B, previous_role: 'hs_coordinator', role: 'coordinator' },
    ]);
  });

  it('aplica el vocabulario nuevo a la política de incidentes', async () => {
    const visible = await inSession(
      db.app,
      { siteIds: [SITE_A], userId: COORDINATOR, role: 'coordinator' },
      'SELECT id FROM incident WHERE id = $1',
      [INCIDENT],
    );

    expect(visible).toEqual([{ id: INCIDENT }]);
  });

  it('permite al coordinator verificar su propia acción y deja la cadena válida', async () => {
    const state = await inSession<{ to_state: string }>(
      db.app,
      { siteIds: [SITE_A], userId: COORDINATOR, role: 'coordinator' },
      'SELECT to_state FROM corrective_action_event WHERE id = $1',
      [EVENT_CLOSED],
    );

    expect(state).toEqual([{ to_state: 'closed' }]);

    const chain = await db.superuser.query<{ hash: Buffer; prev_hash: Buffer | null }>(
      `SELECT hash, prev_hash FROM audit_log WHERE site_id = $1 ORDER BY seq`,
      [SITE_A],
    );

    expect(chain.rows.length).toBeGreaterThan(0);
    expect(chain.rows.every((row) => row.hash.length === 32)).toBe(true);
  });

  it('conserva una escalada histórica y rechaza una nueva con el nivel antiguo', async () => {
    const historical = await db.superuser.query<{ level: string }>(
      'SELECT level FROM corrective_action_escalation WHERE id = $1',
      [HISTORICAL_ESCALATION],
    );

    expect(historical.rows).toEqual([{ level: 'hs_coordinator' }]);

    await expect(
      db.migrator.query(
        `INSERT INTO corrective_action_escalation
           (action_id, site_id, level, due_at, days_overdue)
         VALUES ($1, $2, 'hs_coordinator', now(), 1)`,
        [HISTORICAL_ACTION, SITE_A],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23514');
  });

  it('rechaza los identificadores de rol antiguos en el CHECK', async () => {
    await expect(
      db.migrator.query('UPDATE app_user SET role = \'jhsc_member\' WHERE id = $1', [COORDINATOR]),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23514');
  });

  it('conserva el GRANT de UPDATE de 0047 y FORCE RLS', async () => {
    const grants = await db.superuser.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.column_privileges
        WHERE grantee = 'hs_app' AND table_schema = 'public' AND table_name = 'app_user'
          AND privilege_type = 'UPDATE'
        ORDER BY column_name`,
    );
    const rls = await db.superuser.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class
        WHERE oid = 'corrective_action_escalation'::regclass`,
    );

    expect(grants.rows.map((row) => row.column_name)).toEqual([
      'deactivated_at',
      'email',
      'role',
    ]);
    expect(rls.rows).toEqual([{ relforcerowsecurity: true }]);
  });
});
