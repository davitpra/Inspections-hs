import { afterEach, describe, expect, it } from 'vitest';

import { TEST_DOCUMENT } from '../test/fixtures';
import { freshDatabase } from '../test/database';
import type { OfflineDatabase } from './db';
import { openDraft, saveAnswer } from './drafts';
import { unsyncedLabel, unsyncedStatus } from './unsynced';

const ACCOUNT = 'account-a';
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-08T12:00:00.000Z');

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

async function draftCreatedDaysAgo(
  days: number,
  answers: number,
  inspectionId = crypto.randomUUID(),
): Promise<string> {
  const draft = await openDraft(
    {
      scheduled_inspection_id: inspectionId,
      account_id: ACCOUNT,
      site_id: 'site-1',
      template_version_id: '22222222-2222-4222-8222-222222222222',
    },
    database,
  );

  const keys = ['guarding.installed', 'guarding.rating', 'guarding.gap', 'guarding.hazards'];
  const values: unknown[] = [true, 4, 12.5, ['pinch']];

  for (let index = 0; index < answers; index += 1) {
    await saveAnswer(
      draft.client_submission_id,
      keys[index % keys.length]!,
      values[index % values.length],
      TEST_DOCUMENT,
      database,
    );
  }

  await database.drafts.update(draft.client_submission_id, {
    created_at: new Date(NOW - days * DAY).toISOString(),
  });

  return draft.client_submission_id;
}

describe('unsyncedStatus', () => {
  it('no reporta nada cuando no hay borradores', async () => {
    database = freshDatabase();

    expect(await unsyncedStatus(ACCOUNT, database, NOW)).toEqual({
      answers: 0,
      drafts: 0,
      oldestDraftAgeDays: null,
      warn: false,
    });
  });

  it('cuenta las respuestas sin enviar y la edad del borrador más viejo', async () => {
    database = freshDatabase();
    await draftCreatedDaysAgo(4, 4);
    await draftCreatedDaysAgo(1, 2);

    const status = await unsyncedStatus(ACCOUNT, database, NOW);

    expect(status.answers).toBe(6);
    expect(status.drafts).toBe(2);
    expect(status.oldestDraftAgeDays).toBe(4);
    expect(status.warn).toBe(true);
  });

  /** Spec: "Three days triggers a prominent warning". */
  it('advierte a partir de los 3 días', async () => {
    database = freshDatabase();
    await draftCreatedDaysAgo(3, 1);

    expect((await unsyncedStatus(ACCOUNT, database, NOW)).warn).toBe(true);
  });

  /** Spec: "A two-day-old draft warns nothing" — pero SÍ se reporta. */
  it('a los 2 días informa y no advierte', async () => {
    database = freshDatabase();
    await draftCreatedDaysAgo(2, 3);

    const status = await unsyncedStatus(ACCOUNT, database, NOW);

    expect(status.oldestDraftAgeDays).toBe(2);
    expect(status.answers).toBe(3);
    expect(status.warn).toBe(false);
  });

  /**
   * LA TRAMPA DE D9. Un inspector que abre la aplicación todos los días y toca una
   * respuesta NO reinicia el contador: la edad se cuenta desde `created_at`. Con
   * `updated_at`, la advertencia de los 3 días —la única mitigación verificable de
   * ADR-010— no se dispararía nunca para el usuario que más la necesita.
   */
  it('tocar una respuesta todos los días no reinicia el contador', async () => {
    database = freshDatabase();
    const id = await draftCreatedDaysAgo(5, 1);

    await saveAnswer(id, 'guarding.rating', 5, TEST_DOCUMENT, database);

    const draft = await database.drafts.get(id);
    expect(Date.parse(draft!.updated_at)).toBeGreaterThan(Date.parse(draft!.created_at));

    const status = await unsyncedStatus(ACCOUNT, database, NOW);
    expect(status.oldestDraftAgeDays).toBe(5);
    expect(status.warn).toBe(true);
  });

  /** Spec: "The indicator clears only on acceptance". */
  it('se limpia para una inspección solo cuando el servidor aceptó su envío', async () => {
    database = freshDatabase();
    const id = await draftCreatedDaysAgo(4, 3);

    // Firmar no alcanza: el trabajo sigue sin salir del teléfono.
    await database.drafts.update(id, { status: 'signed' });
    expect((await unsyncedStatus(ACCOUNT, database, NOW)).answers).toBe(3);

    await database.drafts.update(id, { status: 'accepted' });
    expect(await unsyncedStatus(ACCOUNT, database, NOW)).toEqual({
      answers: 0,
      drafts: 0,
      oldestDraftAgeDays: null,
      warn: false,
    });
  });

  it('no cuenta el trabajo sin enviar de otra cuenta del mismo dispositivo', async () => {
    database = freshDatabase();
    await draftCreatedDaysAgo(4, 3);

    expect((await unsyncedStatus('account-b', database, NOW)).answers).toBe(0);
  });
});

describe('unsyncedLabel', () => {
  it('arma el texto que el requisito pide, palabra por palabra', () => {
    expect(
      unsyncedLabel({ answers: 17, drafts: 1, oldestDraftAgeDays: 4, warn: true }),
    ).toBe('17 answers not submitted, draft from 4 days ago');
  });

  it('singulariza la respuesta y el día', () => {
    expect(unsyncedLabel({ answers: 1, drafts: 1, oldestDraftAgeDays: 1, warn: false })).toBe(
      '1 answer not submitted, draft from 1 day ago',
    );
  });

  it('no dice nada cuando no hay nada sin enviar', () => {
    expect(unsyncedLabel({ answers: 0, drafts: 0, oldestDraftAgeDays: null, warn: false })).toBeNull();
  });
});
