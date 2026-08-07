import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { registerSite } from './helpers/catalog';
import {
  insertEvent,
  inScope,
  one,
  startTestDatabase,
  type AuditRow,
  type TestDatabase,
} from './helpers/postgres';

const SITE_A = '33333333-3333-3333-3333-333333333333';
const SITE_B = '44444444-4444-4444-4444-444444444444';
const SITE_CONCURRENT = '55555555-5555-5555-5555-555555555555';
const SITE_TAMPERED = '66666666-6666-6666-6666-666666666666';
const SITE_GAP = '77777777-7777-7777-7777-777777777777';

interface BrokenLink extends Record<string, unknown> {
  broken_id: string;
  broken_seq: string;
  reason: string;
}

const verify = (db: TestDatabase, siteId: string) =>
  inScope<BrokenLink>(db.app, [siteId], 'SELECT * FROM hs_audit_verify_chain($1)', [siteId]);

let db: TestDatabase;

beforeAll(async () => {
  db = await startTestDatabase();

  // Desde `0004` toda entrada del log referencia una fila de `site`. Cada cadena
  // de este spec es la de un sitio, así que cada sitio tiene que existir.
  await registerSite(db.migrator, SITE_A, 'chain-a');
  await registerSite(db.migrator, SITE_B, 'chain-b');
  await registerSite(db.migrator, SITE_CONCURRENT, 'chain-concurrent');
  await registerSite(db.migrator, SITE_TAMPERED, 'chain-tampered');
  await registerSite(db.migrator, SITE_GAP, 'chain-gap');
});

afterAll(async () => {
  await db?.stop();
});

describe('la cadena de hashes es por sitio', () => {
  it('encadena los eventos de un sitio y abre la cadena con prev_hash nulo', async () => {
    const first = await insertEvent(db.app, SITE_A, { payload: { n: 1 } });
    const second = await insertEvent(db.app, SITE_A, { payload: { n: 2 } });
    const third = await insertEvent(db.app, SITE_A, { payload: { n: 3 } });

    expect(first.prev_hash).toBeNull();
    expect(first.hash).not.toBeNull();

    expect(second.prev_hash?.equals(first.hash)).toBe(true);
    expect(third.prev_hash?.equals(second.hash)).toBe(true);

    expect([first.seq, second.seq, third.seq]).toEqual(['1', '2', '3']);
  });

  it('mantiene cadenas independientes entre sitios', async () => {
    // SITE_A ya tiene eventos: la cadena de B igual arranca de cero.
    const firstOfB = await insertEvent(db.app, SITE_B, { payload: { n: 1 } });
    const secondOfB = await insertEvent(db.app, SITE_B, { payload: { n: 2 } });

    expect(firstOfB.prev_hash).toBeNull();
    expect(secondOfB.prev_hash?.equals(firstOfB.hash)).toBe(true);

    const hashesOfA = await inScope<{ hash: Buffer }>(
      db.app,
      [SITE_A],
      'SELECT hash FROM audit_log ORDER BY seq',
    );

    const prevOfB = [firstOfB.prev_hash, secondOfB.prev_hash].filter(
      (value): value is Buffer => value !== null,
    );

    for (const prev of prevOfB) {
      expect(hashesOfA.some((row) => row.hash.equals(prev))).toBe(false);
    }
  });
});

describe('la base es la que escribe la cadena, no el caller', () => {
  it('descarta el hash y el prev_hash que manda el caller', async () => {
    const forgedHash = Buffer.alloc(32, 0xab);
    const forgedPrev = Buffer.alloc(32, 0xcd);

    const row = await insertEvent(db.app, SITE_A, {
      payload: { forged: true },
      forged: { hash: forgedHash, prevHash: forgedPrev },
    });

    expect(row.hash.equals(forgedHash)).toBe(false);
    expect(row.prev_hash?.equals(forgedPrev)).toBe(false);
    await expect(verify(db, SITE_A)).resolves.toEqual([]);
  });

  it('ignora el recorded_at del caller y preserva el occurred_at verbatim', async () => {
    // El caso real: una captura offline que sincroniza días después.
    const occurredAt = new Date(Date.UTC(2020, 0, 15, 10, 30, 0));

    const row = await insertEvent(db.app, SITE_A, {
      payload: { offline: true },
      occurredAt,
      forged: { recordedAt: '2000-01-01T00:00:00Z' },
    });

    expect(row.occurred_at.toISOString()).toBe(occurredAt.toISOString());
    expect(row.recorded_at.getUTCFullYear()).toBeGreaterThan(2020);
    expect(row.recorded_at.getTime()).toBeGreaterThan(row.occurred_at.getTime());
  });

  it('rechaza un evento sin payload o sin event_type', async () => {
    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO audit_log (site_id, event_type, occurred_at) VALUES ($1, 'x', now())`,
        [SITE_A],
      ),
    ).rejects.toSatisfy((error) => (error as { code?: string }).code === '23502');
  });
});

describe('escrituras concurrentes del mismo sitio', () => {
  it('no bifurcan la cadena', async () => {
    // Conexiones separadas del pool, en paralelo: es el escenario que el
    // pg_advisory_xact_lock del trigger tiene que serializar.
    await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        insertEvent(db.app, SITE_CONCURRENT, { payload: { n } }),
      ),
    );

    const rows = await inScope<AuditRow>(
      db.app,
      [SITE_CONCURRENT],
      'SELECT id, seq, hash, prev_hash FROM audit_log ORDER BY seq',
    );

    expect(rows).toHaveLength(8);
    expect(rows.map((row) => row.seq)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);

    let previous = one(rows);
    expect(previous.prev_hash).toBeNull();

    for (const row of rows.slice(1)) {
      expect(row.prev_hash?.equals(previous.hash)).toBe(true);
      previous = row;
    }

    await expect(verify(db, SITE_CONCURRENT)).resolves.toEqual([]);
  });
});

describe('verificación de la cadena', () => {
  it('no reporta nada sobre una cadena sana', async () => {
    await insertEvent(db.app, SITE_TAMPERED, { payload: { n: 1 } });
    await insertEvent(db.app, SITE_TAMPERED, { payload: { n: 2 } });
    await insertEvent(db.app, SITE_TAMPERED, { payload: { n: 3 } });

    await expect(verify(db, SITE_TAMPERED)).resolves.toEqual([]);
  });

  it('localiza el eslabón cuyo payload fue alterado fuera de banda', async () => {
    // Como superusuario: es exactamente el privilegio que la aplicación no tiene
    // — un backup restaurado a mano, o acceso directo a la base.
    const target = one(
      await inScope<{ id: string }>(
      db.app,
      [SITE_TAMPERED],
      'SELECT id FROM audit_log WHERE site_id = $1 ORDER BY seq OFFSET 1 LIMIT 1',
      [SITE_TAMPERED],
    ),
    );

    await db.superuser.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_forbid_mutation');
    await db.superuser.query(
      `UPDATE audit_log SET payload = '{"tampered":true}'::jsonb WHERE id = $1`,
      [target.id],
    );
    await db.superuser.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_forbid_mutation');

    const broken = await verify(db, SITE_TAMPERED);

    expect(broken).toHaveLength(1);
    expect(one(broken).broken_id).toBe(target.id);
    expect(one(broken).reason).toContain('hash');
  });

  it('detecta un evento eliminado del medio de la cadena', async () => {
    await insertEvent(db.app, SITE_GAP, { payload: { n: 1 } });
    await insertEvent(db.app, SITE_GAP, { payload: { n: 2 } });
    const third = await insertEvent(db.app, SITE_GAP, { payload: { n: 3 } });

    const middle = one(
      await inScope<{ id: string }>(
      db.app,
      [SITE_GAP],
      'SELECT id FROM audit_log WHERE site_id = $1 AND seq = 2',
      [SITE_GAP],
    ),
    );

    await db.superuser.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_forbid_mutation');
    await db.superuser.query('DELETE FROM audit_log WHERE id = $1', [middle.id]);
    await db.superuser.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_forbid_mutation');

    const broken = await verify(db, SITE_GAP);

    expect(broken).toHaveLength(1);
    expect(one(broken).broken_id).toBe(third.id);
    expect(one(broken).reason).toContain('prev_hash');
  });
});
