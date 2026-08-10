import { randomUUID } from 'node:crypto';

import type { InspectionSubmission } from '@hs/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SubmissionsService } from '../src/inspections/submissions.service';
import { registerSite } from './helpers/catalog';
import { createAccount } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';
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

/**
 * Migración 0009 — El envío de una inspección en la cadena.
 *
 * Es el primer evento del sistema que NO ocurrió mientras el servidor miraba: se firmó
 * sin señal y llegó días después. Por eso es el primero que ejerce de verdad el doble
 * timestamp del riesgo C, y por eso `hs_audit_entry_at` existe.
 *
 * Las tres propiedades que se prueban acá y en ningún otro lado: un envío es UN eslabón
 * aunque traiga doscientas respuestas, un reenvío no es ninguno, y un rechazo tampoco.
 */
describe('el envío de una inspección en la cadena', () => {
  const SITE_SUBMIT = '88888888-8888-4888-8888-888888888888';

  /** Cuarenta ítems, para que "una inspección grande es un solo eslabón" signifique algo. */
  const ITEM_COUNT = 40;
  const itemKeys = Array.from({ length: ITEM_COUNT }, (_, i) => `chain.item-${i + 1}`);

  const SIGNED_AT = '2026-08-03T14:20:00-04:00';

  let stack: SchedulingStack;
  let submissions: SubmissionsService;
  let templateId: string;
  let versionId: string;
  let inspector: { accountId: string };
  let periodCursor = 0;

  const sessionFor = (accountId: string) => ({
    userId: accountId,
    role: 'jhsc_member',
    siteIds: [SITE_SUBMIT],
  });

  async function freshInspection(): Promise<string> {
    periodCursor += 1;

    return scheduleInspection(db.app, {
      siteId: SITE_SUBMIT,
      periodStart: `2032-${String(periodCursor).padStart(2, '0')}-01`,
      templateId,
      templateVersionId: versionId,
      inspectorId: inspector.accountId,
    });
  }

  function submissionFor(scheduledId: string): InspectionSubmission {
    const answers: Record<string, unknown> = {};

    for (const key of itemKeys) answers[key] = true;

    return {
      client_submission_id: randomUUID(),
      scheduled_inspection_id: scheduledId,
      template_version_id: versionId,
      answers: answers as InspectionSubmission['answers'],
      photos: {},
      // Todas las respuestas son afirmativas, así que este envío no deriva ningún
      // hallazgo: el bloque va vacío y el conteo de eslabones de esta suite sigue
      // midiendo exactamente lo que dice medir.
      findings: {},
      signed_at: SIGNED_AT,
    };
  }

  async function linkCount(): Promise<number> {
    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_SUBMIT],
      'SELECT count(*)::text AS count FROM audit_log WHERE site_id = $1',
      [SITE_SUBMIT],
    );

    return Number(one(rows).count);
  }

  beforeAll(async () => {
    await registerSite(db.migrator, SITE_SUBMIT, 'chain-submit');

    stack = createSchedulingStack(db.appUrl);
    submissions = new SubmissionsService(stack.db);

    templateId = await createTemplate(db.migrator, 'chain-template', 'Walkthrough');
    await registerItems(db.migrator, templateId, itemKeys);

    versionId = await publishVersion(db.migrator, templateId, 1, {
      sections: [
        {
          section_key: 'general',
          section_title: 'General',
          position: 1,
          items: itemKeys.map((item_key, index) => ({
            item_key,
            prompt: `Item ${index + 1}`,
            position: index + 1,
            required: true,
            response_type: 'yes_no' as const,
          })),
        },
      ],
    });

    inspector = await createAccount(db.app, {
      siteIds: [SITE_SUBMIT],
      role: 'jhsc_member',
    });
  }, 120_000);

  afterAll(async () => {
    await stack?.stop();
  });

  it('una inspección de 40 respuestas agrega UN solo eslabón', async () => {
    // El conteo se toma DESPUÉS de programar: abrir una inspección también escribe su
    // eslabón (`inspection.scheduled`, migración 0008). Lo que se mide acá es cuánto
    // agrega el ENVÍO.
    const payload = submissionFor(await freshInspection());
    const before = await linkCount();

    const accepted = await submissions.ingest(sessionFor(inspector.accountId), payload);

    expect(await linkCount()).toBe(before + 1);

    const rows = await inScope<AuditRow>(
      db.app,
      [SITE_SUBMIT],
      `SELECT id, site_id, seq, event_type, payload, occurred_at, recorded_at, hash, prev_hash
         FROM audit_log WHERE site_id = $1 ORDER BY seq DESC LIMIT 1`,
      [SITE_SUBMIT],
    );

    const entry = one(rows);
    const payloadBody = entry.payload as Record<string, unknown>;

    expect(entry.event_type).toBe('inspection.submitted');
    expect(payloadBody.inspection_id).toBe(accepted.id);
    expect(payloadBody.client_submission_id).toBe(payload.client_submission_id);
    expect(payloadBody.submitted_by).toBe(inspector.accountId);
    // Lo que una verificación compara contra la tabla sin confiar en el conteo del día.
    expect(payloadBody.answer_count).toBe(ITEM_COUNT);
  });

  it('el actor de la entrada es la cuenta que envió', async () => {
    const payload = submissionFor(await freshInspection());

    await submissions.ingest(sessionFor(inspector.accountId), payload);

    const rows = await inScope<{ actor_user_id: string | null }>(
      db.app,
      [SITE_SUBMIT],
      `SELECT actor_user_id FROM audit_log
        WHERE site_id = $1 AND payload ->> 'client_submission_id' = $2`,
      [SITE_SUBMIT, payload.client_submission_id],
    );

    expect(one(rows).actor_user_id).toBe(inspector.accountId);
  });

  it('occurred_at es el reloj del dispositivo y recorded_at el del servidor', async () => {
    const payload = submissionFor(await freshInspection());

    await submissions.ingest(sessionFor(inspector.accountId), payload);

    const rows = await inScope<{ occurred_at: Date; recorded_at: Date }>(
      db.app,
      [SITE_SUBMIT],
      `SELECT occurred_at, recorded_at FROM audit_log
        WHERE site_id = $1 AND payload ->> 'client_submission_id' = $2`,
      [SITE_SUBMIT, payload.client_submission_id],
    );

    const entry = one(rows);

    // Riesgo C de §5: una inspección firmada el 3 y sincronizada el 9 NO se registra
    // como ocurrida el 9. Es la razón entera de que `hs_audit_entry_at` exista.
    expect(entry.occurred_at.toISOString()).toBe(new Date(SIGNED_AT).toISOString());
    expect(entry.recorded_at.getTime()).toBeGreaterThan(entry.occurred_at.getTime());
  });

  it('un reenvío no agrega eslabón', async () => {
    const payload = submissionFor(await freshInspection());
    const session = sessionFor(inspector.accountId);

    await submissions.ingest(session, payload);
    const afterFirst = await linkCount();

    for (let i = 0; i < 5; i += 1) {
      const replay = await submissions.ingest(session, payload);
      expect(replay.created).toBe(false);
    }

    expect(await linkCount()).toBe(afterFirst);
  });

  it('veinte rechazos seguidos no agregan ninguno, y la cadena verifica intacta', async () => {
    const scheduled = await freshInspection();
    const before = await linkCount();

    for (let i = 0; i < 20; i += 1) {
      const broken = submissionFor(scheduled);
      delete (broken.answers as Record<string, unknown>)['chain.item-1'];

      await expect(
        submissions.ingest(sessionFor(inspector.accountId), broken),
      ).rejects.toMatchObject({ response: { code: 'validation_failed' } });
    }

    expect(await linkCount()).toBe(before);
    expect(await verify(db, SITE_SUBMIT)).toHaveLength(0);
  });

  it('hs_audit_entry_at no cambió el comportamiento de los eventos existentes', async () => {
    // La variante de cuatro argumentos se agregó y la de tres pasó a delegar en ella.
    // Un evento de programación —que no tiene reloj de dispositivo— tiene que seguir
    // escribiendo `occurred_at = recorded_at`, como antes de 0009.
    const scheduled = await freshInspection();

    const rows = await inScope<{ occurred_at: Date; recorded_at: Date }>(
      db.app,
      [SITE_SUBMIT],
      `SELECT occurred_at, recorded_at FROM audit_log
        WHERE site_id = $1 AND event_type = 'inspection.scheduled'
          AND payload ->> 'scheduled_inspection_id' = $2`,
      [SITE_SUBMIT, scheduled],
    );

    const entry = one(rows);

    expect(entry.occurred_at.toISOString()).toBe(entry.recorded_at.toISOString());
  });

  it('la agrupación por item_key cruza versiones: la serie de la etapa 7', async () => {
    // El spike 3 visto desde el lado de las respuestas. Dos inspecciones contra dos
    // versiones distintas contestan el MISMO concepto: la recurrencia las cuenta juntas
    // y la fidelidad legal las distingue.
    const versionTwo = await publishVersion(db.migrator, templateId, 2, {
      sections: [
        {
          section_key: 'general',
          section_title: 'General',
          position: 1,
          items: itemKeys.map((item_key, index) => ({
            item_key,
            // Redacción distinta, MISMA item_key: editar no genera key nueva (§4).
            prompt: `Reworded item ${index + 1}`,
            position: index + 1,
            required: true,
            response_type: 'yes_no' as const,
          })),
        },
      ],
    });

    periodCursor += 1;

    const second = await scheduleInspection(db.app, {
      siteId: SITE_SUBMIT,
      periodStart: `2033-${String(periodCursor % 12 || 12).padStart(2, '0')}-01`,
      templateId,
      templateVersionId: versionTwo,
      inspectorId: inspector.accountId,
    });

    const payload = submissionFor(second);
    payload.template_version_id = versionTwo;

    await submissions.ingest(sessionFor(inspector.accountId), payload);

    const grouped = await inScope<{ item_key: string; answers: string; versions: string }>(
      db.app,
      [SITE_SUBMIT],
      `SELECT a.item_key,
              count(*)::text AS answers,
              count(DISTINCT a.template_version_item_id)::text AS versions
         FROM inspection_answer a
        WHERE a.site_id = $1 AND a.item_key = 'chain.item-2'
        GROUP BY a.item_key`,
      [SITE_SUBMIT],
    );

    const row = one(grouped);

    // Un solo grupo, varias respuestas, y filas publicadas distintas dentro de él.
    expect(Number(row.answers)).toBeGreaterThan(1);
    expect(Number(row.versions)).toBe(2);
  });
});
