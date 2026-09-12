import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuthModule } from '../src/auth/auth.module';
import { SessionService } from '../src/auth/session.service';
import { DbModule } from '../src/db/db.module';
import { RosterModule } from '../src/roster/roster.module';
import { applyRoster } from '../src/roster/apply-roster';
import { parseRosterCsv } from '../src/roster/parse-roster-csv';
import { registerSite } from './helpers/catalog';
import { createAccount, createPerson } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

const SITE_A = 'b6000000-0000-4000-8000-000000000001';
const SITE_B = 'b6000000-0000-4000-8000-000000000002';
const HEADER = 'employee_number,first_name,last_name,site_code,status';

let db: TestDatabase;
let app: INestApplication;
let baseUrl: string;
let sessions: SessionService;
let coordinatorId: string;
let coordinatorToken: string;

const tokens = new Map<string, string>();

function csv(...rows: string[]): string {
  return [HEADER, ...rows].join('\n');
}

function upload(
  content: string | Uint8Array,
  filename = 'roster.csv',
  field = 'file',
  type = 'text/csv',
): FormData {
  const form = new FormData();
  form.append(field, new Blob([content], { type }), filename);
  return form;
}

async function post(token: string, form: FormData, query = ''): Promise<Response> {
  return fetch(`${baseUrl}/people/import${query}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

async function importCount(): Promise<number> {
  const rows = await inScope<{ count: string }>(
    db.migrator,
    [],
    'SELECT count(*)::text AS count FROM roster_import',
  );
  return Number(one(rows).count);
}

async function person(employeeNumber: string) {
  const rows = await inScope<{
    site_id: string;
    first_name: string;
    last_name: string;
    deactivated_at: Date | null;
  }>(
    db.migrator,
    [SITE_A, SITE_B],
    `SELECT site_id, first_name, last_name, deactivated_at
       FROM person WHERE employee_number = $1`,
    [employeeNumber],
  );
  return rows[0] ?? null;
}

beforeAll(async () => {
  db = await startTestDatabase();
  await registerSite(db.migrator, SITE_A, 'http-a', 'HTTP A');
  await registerSite(db.migrator, SITE_B, 'http-b', 'HTTP B');

  const coordinator = await createAccount(db.app, {
    siteIds: [SITE_A],
    role: 'hs_coordinator',
  });
  coordinatorId = coordinator.accountId;

  for (const role of ['jhsc_member']) {
    const account = await createAccount(db.app, {
      siteIds: [SITE_A],
      role,
    });
    tokens.set(role, account.accountId);
  }

  const previousUrl = process.env.DATABASE_URL;
  const previousSecret = process.env.BETTER_AUTH_SECRET;
  process.env.DATABASE_URL = db.appUrl;
  process.env.BETTER_AUTH_SECRET = 'integration-test-secret-0123456789abcdef';

  const moduleRef = await Test.createTestingModule({
    imports: [DbModule, AuthModule, RosterModule],
  }).compile();
  app = moduleRef.createNestApplication();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
  sessions = app.get(SessionService);
  coordinatorToken = (await sessions.issue(coordinatorId)).accessToken;

  for (const [role, accountId] of tokens) {
    tokens.set(role, (await sessions.issue(accountId)).accessToken);
  }

  restore('DATABASE_URL', previousUrl);
  restore('BETTER_AUTH_SECRET', previousSecret);
}, 180_000);

afterAll(async () => {
  await app?.close();
  await db?.stop();
});

describe('POST /people/import', () => {
  it('deriva archivo, autor y alcance del upload y de la sesión', async () => {
    const form = upload(
      csv('HTTP-1,Ada,Reid,http-a,active', 'HTTP-2,Bo,Chen,http-b,active'),
      '../from-console.csv',
      'file',
      'application/octet-stream',
    );
    form.append('site_id', SITE_B);
    form.append('scope', SITE_B);

    const response = await post(coordinatorToken, form, `?site_id=${SITE_B}&scope=${SITE_B}`);
    const report = await body(response);

    expect(response.status).toBe(200);
    expect(report).toMatchObject({
      source_filename: 'from-console.csv',
      rows_read: 2,
      rows_applied: 1,
      rows_rejected: 1,
    });
    expect(await person('HTTP-1')).toMatchObject({ site_id: SITE_A });
    expect(await person('HTTP-2')).toBeNull();

    const stored = await inScope<{ imported_by: string; source_filename: string }>(
      db.migrator,
      [],
      'SELECT imported_by, source_filename FROM roster_import WHERE id = $1',
      [report.import_id],
    );
    expect(one(stored)).toEqual({ imported_by: coordinatorId, source_filename: 'from-console.csv' });
  });

  it('reimporta y converge nombres, sitio y estado, dejando otro lote', async () => {
    await createPerson(db.app, SITE_A, { employeeNumber: 'HTTP-REPEAT', lastName: 'Anterior' });
    const text = csv('HTTP-REPEAT,Nuevo,Nombre,http-a,inactive');

    const first = await body(await post(coordinatorToken, upload(text, 'repeat.csv')));
    const second = await body(await post(coordinatorToken, upload(text, 'repeat.csv')));

    expect(first.import_id).not.toBe(second.import_id);
    expect(second).toMatchObject({ rows_applied: 1, rows_rejected: 0 });
    expect(await person('HTTP-REPEAT')).toMatchObject({
      first_name: 'Nuevo',
      last_name: 'Nombre',
      site_id: SITE_A,
    });
    expect((await person('HTTP-REPEAT'))?.deactivated_at).not.toBeNull();
  });

  it('niega al miembro del JHSC sin escribir personas, lotes ni auditoría', async () => {
    const beforeImports = await importCount();
    const beforeAudit = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A],
      'SELECT count(*)::text AS count FROM audit_log',
    );

    for (const role of ['jhsc_member']) {
      const response = await post(
        tokens.get(role)!,
        upload(csv(`ROLE-${role},No,Crear,http-a,active`, 'HTTP-1,No,Cambiar,http-a,active')),
      );
      expect(response.status).toBe(403);
      expect(await body(response)).toMatchObject({ code: 'roster_forbidden' });
      expect(await person(`ROLE-${role}`)).toBeNull();
    }

    expect(await importCount()).toBe(beforeImports);
    const afterAudit = await inScope<{ count: string }>(
      db.migrator,
      [SITE_A],
      'SELECT count(*)::text AS count FROM audit_log',
    );
    expect(one(afterAudit).count).toBe(one(beforeAudit).count);
    expect((await person('HTTP-1'))?.last_name).toBe('Reid');
  });

  it('normaliza uploads malformados y no escribe un lote', async () => {
    const cases: FormData[] = [];
    cases.push(new FormData());

    const two = upload(csv('BAD-1,A,B,http-a,active'));
    two.append('file', new Blob([csv('BAD-2,A,B,http-a,active')]), 'second.csv');
    cases.push(two);
    cases.push(upload(csv('BAD-3,A,B,http-a,active'), 'wrong.csv', 'other'));
    cases.push(upload(csv('BAD-4,A,B,http-a,active'), ''));
    cases.push(upload('first_name,last_name,site_code,status\nA,B,http-a,active'));
    cases.push(upload(`${HEADER}\nBAD-5,A,"B,http-a,active`));

    for (const form of cases) {
      const before = await importCount();
      const response = await post(coordinatorToken, form);
      expect(response.status).toBe(400);
      expect(await body(response)).toMatchObject({ code: 'roster_file_unusable' });
      expect(await importCount()).toBe(before);
    }
  });

  it('rechaza 2 MiB + 1 y acepta un MIME arbitrario', async () => {
    const before = await importCount();
    const oversized = await post(
      coordinatorToken,
      upload(new Uint8Array(2 * 1024 * 1024 + 1), 'large.csv'),
    );
    expect(oversized.status).toBe(413);
    expect(await body(oversized)).toMatchObject({ code: 'roster_file_too_large' });
    expect(await importCount()).toBe(before);

    const legal = await post(
      coordinatorToken,
      upload(csv('MIME-1,Ada,Reid,http-a,active'), 'mime.bin', 'file', 'application/x-custom'),
    );
    expect(legal.status).toBe(200);
  });

  it('devuelve 200 para rechazo parcial y total, preservando números de fila', async () => {
    await createPerson(db.app, SITE_B, { employeeNumber: 'HIDDEN-HTTP', lastName: 'Oculto' });

    const partial = await body(
      await post(
        coordinatorToken,
        upload(csv('HIDDEN-HTTP,No,Cambiar,http-a,active', 'PARTIAL-OK,Sí,Aplicar,http-a,active')),
      ),
    );
    expect(partial).toMatchObject({ rows_applied: 1, rows_rejected: 1 });
    expect(partial.rejections).toEqual([
      expect.objectContaining({ row_number: 2, employee_number: 'HIDDEN-HTTP' }),
    ]);
    expect(JSON.stringify(partial.rejections)).not.toMatch(/http-b/i);
    expect((await person('HIDDEN-HTTP'))?.last_name).toBe('Oculto');

    const response = await post(
      coordinatorToken,
      upload(csv('TOTAL-1,A,B,http-b,active', 'TOTAL-2,C,D,missing,active')),
    );
    const total = await body(response);
    expect(response.status).toBe(200);
    expect(total).toMatchObject({ rows_read: 2, rows_applied: 0, rows_rejected: 2 });
    expect((total.rejections as { row_number: number }[]).map((row) => row.row_number)).toEqual([2, 3]);

    const stored = await inScope<{ rows_applied: number; rows_rejected: number }>(
      db.migrator,
      [],
      'SELECT rows_applied, rows_rejected FROM roster_import WHERE id = $1',
      [total.import_id],
    );
    expect(one(stored)).toEqual({ rows_applied: 0, rows_rejected: 2 });
  });

  it('produce el mismo resultado que el wrapper del comando', async () => {
    const text = csv('EQUIV-1,Ada,Reid,http-a,active', 'EQUIV-2,Bo,Chen,http-b,active');
    const http = await body(await post(coordinatorToken, upload(text, 'same.csv')));
    const command = await applyRoster(
      db.app,
      parseRosterCsv(text),
      { siteIds: [SITE_A], userId: coordinatorId },
      { sourceFilename: 'same.csv' },
    );

    expect(command).toMatchObject({
      rows_read: http.rows_read,
      rows_applied: http.rows_applied,
      rows_rejected: http.rows_rejected,
      rejections: http.rejections,
    });
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
