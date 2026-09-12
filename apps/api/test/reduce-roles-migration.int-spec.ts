import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startTestDatabase, type TestDatabase } from './helpers/postgres';

let db: TestDatabase;

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0046_reduce_roles_to_three.sql'),
  'utf8',
);
const guard = migration.slice(0, migration.indexOf('--> statement-breakpoint'));

beforeAll(async () => {
  db = await startTestDatabase();
}, 180_000);

afterAll(async () => {
  await db.stop();
});

async function guardRejects(
  setup: string,
  expectedMessage: RegExp,
): Promise<void> {
  const client = await db.migrator.connect();

  try {
    await client.query('BEGIN');
    await client.query(`CREATE TEMP TABLE app_user (role text) ON COMMIT DROP;
      CREATE TEMP TABLE corrective_action_escalation (level text) ON COMMIT DROP;
      CREATE TEMP TABLE notification (kind text) ON COMMIT DROP;`);
    await client.query(setup);
    await expect(client.query(guard)).rejects.toThrow(expectedMessage);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('guard de la migración 0046', () => {
  it.each(['supervisor', 'external_auditor'])('rechaza una cuenta con el rol retirado %s', async (role) => {
    await guardRejects(
      `INSERT INTO app_user (role) VALUES ('${role}')`,
      /cannot retire an app_user role/,
    );
  });

  it('rechaza un escalamiento al nivel retirado', async () => {
    await guardRejects(
      "INSERT INTO corrective_action_escalation (level) VALUES ('supervisor')",
      /cannot retire the supervisor escalation level/,
    );
  });

  it('rechaza una notificación del tipo retirado', async () => {
    await guardRejects(
      "INSERT INTO notification (kind) VALUES ('corrective_action_overdue_supervisor')",
      /cannot retire the supervisor notification kind/,
    );
  });
});
