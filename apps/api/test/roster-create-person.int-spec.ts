import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { applyRoster } from '../src/roster/apply-roster';
import { DbService } from '../src/db/db.service';
import { parseRosterCsv } from '../src/roster/parse-roster-csv';
import { RosterService } from '../src/roster/roster.service';
import { registerSite } from './helpers/catalog';
import { createAccount, createPerson, personById } from './helpers/identity';
import { inScope, one, startTestDatabase, type TestDatabase } from './helpers/postgres';

/**
 * El alta de UNA persona (`add-person-to-roster-by-hand`), en la línea de
 * `roster-administration.int-spec.ts` — aquel es de lectura, este es la única escritura
 * por persona que la consola tiene.
 *
 * LO QUE JUSTIFICA EL ARCHIVO: que el duplicado NO distingue una colisión dentro del
 * alcance de una fuera de él (design D3, y hay que probarlo contra RLS de verdad, no
 * contra un mock); que el sitio fuera de alcance se rechaza ANTES de tocar la base
 * (design D4); y que un CSV posterior pisa el alta a mano sin caso especial (design D1).
 */

const SITE_A = 'a6000000-0000-4000-8000-000000000001';
const SITE_B = 'a6000000-0000-4000-8000-000000000002';

let db: TestDatabase;
let dbService: DbService;
let roster: RosterService;

let coordinatorId: string;
let narrowId: string;
let supervisorId: string;

const asCoordinator = () => ({
  userId: coordinatorId,
  role: 'coordinator',
  siteIds: [SITE_A, SITE_B],
});

/** Un coordinador que solo alcanza la planta A. Es con quien se prueba el borde. */
const asNarrowCoordinator = () => ({
  userId: narrowId,
  role: 'coordinator',
  siteIds: [SITE_A],
});

beforeAll(async () => {
  db = await startTestDatabase();

  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = db.appUrl;
  dbService = new DbService();
  process.env.DATABASE_URL = previous;

  roster = new RosterService(dbService);

  await registerSite(db.migrator, SITE_A, 'create-a', 'Create A');
  await registerSite(db.migrator, SITE_B, 'create-b', 'Create B');

  const coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'coordinator',
  });
  coordinatorId = coordinator.accountId;

  const narrow = await createAccount(db.app, { siteIds: [SITE_A], role: 'coordinator' });
  narrowId = narrow.accountId;

  const supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'inspector' });
  supervisorId = supervisor.accountId;
}, 180_000);

afterAll(async () => {
  await dbService.onModuleDestroy();
  await db.stop();
});

async function auditEntryFor(siteId: string, personId: string) {
  const rows = await inScope<{ event_type: string; payload: Record<string, unknown> }>(
    db.migrator,
    [siteId],
    `SELECT event_type, payload FROM audit_log WHERE site_id = $1 AND payload ->> 'person_id' = $2`,
    [siteId, personId],
  );

  return rows;
}

describe('el alta correcta', () => {
  it('crea la persona y aparece en el roster de esa planta', async () => {
    const person = await roster.create(asCoordinator(), {
      site_id: SITE_A,
      employee_number: 'NEW-1',
      first_name: 'Grace',
      last_name: 'Hopper',
    });

    expect(person).toMatchObject({
      site_id: SITE_A,
      employee_number: 'NEW-1',
      first_name: 'Grace',
      last_name: 'Hopper',
      deactivated_at: null,
    });

    const rows = await roster.list(asCoordinator(), { site_id: SITE_A, status: 'active' });
    expect(rows.map((row) => row.employee_number)).toContain('NEW-1');
  });

  it('queda auditada como creación, igual que la del importador', async () => {
    const person = await roster.create(asCoordinator(), {
      site_id: SITE_A,
      employee_number: 'NEW-AUDIT',
      first_name: 'Ada',
      last_name: 'Lovelace',
    });

    const entries = await auditEntryFor(SITE_A, person.id);

    expect(entries.map((entry) => entry.event_type)).toContain('person.created');
    const created = entries.find((entry) => entry.event_type === 'person.created');
    expect(created?.payload.employee_number).toBe('NEW-AUDIT');
  });
});

describe('el duplicado', () => {
  it('se rechaza dentro de la misma planta, sin tocar a la persona que ya existía', async () => {
    const existing = await createPerson(db.app, SITE_A, {
      employeeNumber: 'DUP-1',
      lastName: 'Original',
    });

    await expect(
      roster.create(asCoordinator(), {
        site_id: SITE_A,
        employee_number: 'DUP-1',
        first_name: 'Otra',
        last_name: 'Persona',
      }),
    ).rejects.toMatchObject({ response: { code: 'person_employee_number_taken' } });

    const person = await personById(db.app, [SITE_A], existing);
    expect(person.last_name).toBe('Original');
    expect(person.site_id).toBe(SITE_A);
  });

  it('contra una persona de una planta fuera del alcance responde igual, y no la toca ni la revela', async () => {
    const existing = await createPerson(db.app, SITE_B, {
      employeeNumber: 'DUP-OUTSIDE',
      lastName: 'Ajena',
    });

    await expect(
      roster.create(asNarrowCoordinator(), {
        site_id: SITE_A,
        employee_number: 'DUP-OUTSIDE',
        first_name: 'Otra',
        last_name: 'Persona',
      }),
    ).rejects.toMatchObject({ response: { code: 'person_employee_number_taken' } });

    const person = await personById(db.app, [SITE_B], existing);
    expect(person.last_name).toBe('Ajena');
    expect(person.deactivated_at).toBeNull();
  });
});

describe('el sitio fuera del alcance', () => {
  it('se rechaza antes de tocar la base, sin crear ninguna fila', async () => {
    await expect(
      roster.create(asNarrowCoordinator(), {
        site_id: SITE_B,
        employee_number: 'OUT-OF-SCOPE',
        first_name: 'Nadie',
        last_name: 'Debería',
      }),
    ).rejects.toMatchObject({ response: { code: 'person_site_out_of_scope' } });

    const rows = await inScope<{ count: string }>(
      db.migrator,
      [SITE_B],
      'SELECT count(*)::text AS count FROM person WHERE employee_number = $1',
      ['OUT-OF-SCOPE'],
    );

    expect(one(rows).count).toBe('0');
  });
});

describe('cualquier otro rol', () => {
  it('lo tiene prohibido', async () => {
    for (const role of ['inspector']) {
      await expect(
        roster.create(
          { userId: supervisorId, role, siteIds: [SITE_A] },
          { site_id: SITE_A, employee_number: `ROLE-${role}`, first_name: 'X', last_name: 'Y' },
        ),
      ).rejects.toMatchObject({ response: { code: 'roster_forbidden' } });
    }
  });
});

describe('la precedencia del CSV (design D1)', () => {
  it('un import posterior con el mismo employee_number pisa el alta a mano, sin caso especial', async () => {
    await roster.create(asCoordinator(), {
      site_id: SITE_A,
      employee_number: 'E-4417',
      first_name: 'Manual',
      last_name: 'Alta',
    });

    const report = await applyRoster(
      db.app,
      parseRosterCsv(
        ['employee_number,first_name,last_name,site_code,status', 'E-4417,Del,Archivo,create-b,active'].join(
          '\n',
        ),
      ),
      { siteIds: [SITE_A, SITE_B], userId: coordinatorId },
      { sourceFilename: 'precedence.csv' },
    );

    expect(report.rows_applied).toBe(1);
    expect(report.rows_rejected).toBe(0);

    const rows = await inScope<{ last_name: string; site_id: string }>(
      db.migrator,
      [SITE_A, SITE_B],
      'SELECT last_name, site_id FROM person WHERE employee_number = $1',
      ['E-4417'],
    );

    expect(one(rows).last_name).toBe('Archivo');
    expect(one(rows).site_id).toBe(SITE_B);
  });
});
