import { afterEach, describe, expect, it } from 'vitest';

import { TEST_DOCUMENT } from '../test/fixtures';
import { freshDatabase, reopen } from '../test/database';
import type { OfflineDatabase } from './db';
import {
  documentForDraft,
  findDraft,
  listDrafts,
  loadDraft,
  openDraft,
  saveAnswer,
  setCurrentItem,
  signDraft,
} from './drafts';

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const ACCOUNT_A = 'account-a';
const ACCOUNT_B = 'account-b';

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

function input(accountId = ACCOUNT_A) {
  return {
    scheduled_inspection_id: INSPECTION_ID,
    account_id: accountId,
    site_id: 'site-1',
    template_version_id: VERSION_ID,
  };
}

describe('openDraft', () => {
  it('genera el client_submission_id como clave primaria de la fila', async () => {
    database = freshDatabase();

    const draft = await openDraft(input(), database);

    expect(draft.client_submission_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await database.drafts.get(draft.client_submission_id)).toBeDefined();
  });

  it('reabrir devuelve el mismo borrador y no crea otro', async () => {
    database = freshDatabase();

    const first = await openDraft(input(), database);
    const second = await openDraft(input(), database);

    expect(second.client_submission_id).toBe(first.client_submission_id);
    expect(await database.drafts.count()).toBe(1);
  });

  /** Spec: "The identifier survives a full application restart". */
  it('el identificador sobrevive a cerrar la aplicación por completo', async () => {
    database = freshDatabase();
    const created = await openDraft(input(), database);

    database = await reopen(database);
    const reopened = await openDraft(input(), database);

    expect(reopened.client_submission_id).toBe(created.client_submission_id);
  });

  /** Spec: "A second draft gets a different identifier". */
  it('dos borradores del mismo dispositivo llevan identificadores distintos', async () => {
    database = freshDatabase();

    const first = await openDraft(input(), database);
    const second = await openDraft(
      { ...input(), scheduled_inspection_id: '99999999-9999-4999-8999-999999999999' },
      database,
    );

    expect(second.client_submission_id).not.toBe(first.client_submission_id);
  });

  /** Spec: "A different account does not see another's draft". */
  it('un borrador de la cuenta A no se lista ni se lee para la cuenta B', async () => {
    database = freshDatabase();
    const draftOfA = await openDraft(input(ACCOUNT_A), database);

    expect(await findDraft(INSPECTION_ID, ACCOUNT_B, database)).toBeUndefined();
    expect(await listDrafts(ACCOUNT_B, database)).toEqual([]);

    // Y abrirla como B crea el borrador de B, no toma el de A.
    const draftOfB = await openDraft(input(ACCOUNT_B), database);
    expect(draftOfB.client_submission_id).not.toBe(draftOfA.client_submission_id);
    expect(await listDrafts(ACCOUNT_A, database)).toHaveLength(1);
  });
});

describe('saveAnswer', () => {
  it('escribe la respuesta y la deja leída inmediatamente', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await saveAnswer(
      draft.client_submission_id,
      'guarding.installed',
      true,
      TEST_DOCUMENT,
      database,
    );

    const loaded = await loadDraft(draft.client_submission_id, database);
    expect(loaded?.answers['guarding.installed']).toBe(true);
    expect(loaded?.draft.current_item_key).toBe('guarding.installed');
  });

  /**
   * Spec: "A killed application loses nothing" — doce respuestas sobreviven a recrear
   * la base desde cero, que es el equivalente de cerrar la aplicación.
   */
  it('doce respuestas sobreviven a cerrar y reabrir la aplicación', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    const entries: [string, unknown][] = [
      ['guarding.installed', false],
      ['guarding.applies', 'yes'],
      ['guarding.rating', 4],
      ['guarding.gap', 12.5],
      ['guarding.hazards', ['pinch', 'noise']],
      ['guarding.reason', 'The guard was removed for maintenance'],
      ['guarding.severity', 'high'],
      ['closing.signature', { object_key: 'k', signed_at: '2026-08-01T10:00:00.000Z' }],
    ];

    for (const [key, value] of entries) {
      await saveAnswer(draft.client_submission_id, key, value, TEST_DOCUMENT, database);
    }

    // Y cuatro más, reescribiendo las mismas keys: un `put` sobre la clave compuesta.
    await saveAnswer(draft.client_submission_id, 'guarding.rating', 5, TEST_DOCUMENT, database);
    await saveAnswer(draft.client_submission_id, 'guarding.gap', 3.2, TEST_DOCUMENT, database);
    await saveAnswer(
      draft.client_submission_id,
      'guarding.severity',
      'low',
      TEST_DOCUMENT,
      database,
    );
    await saveAnswer(
      draft.client_submission_id,
      'guarding.applies',
      'na',
      TEST_DOCUMENT,
      database,
    );

    database = await reopen(database);

    const loaded = await loadDraft(draft.client_submission_id, database);

    expect(Object.keys(loaded?.answers ?? {})).toHaveLength(entries.length);
    expect(loaded?.answers['guarding.rating']).toBe(5);
    expect(loaded?.answers['guarding.severity']).toBe('low');
    // Spec: "the inspection resumes at the item that was last shown".
    expect(loaded?.draft.current_item_key).toBe('guarding.applies');
  });

  /**
   * D6 / spec: "A hidden item's answer is not retained". Se PODA, no se filtra al
   * enviar: guardarla haría que el contador de respuestas sin enviar mienta.
   */
  it('poda la respuesta de un ítem que otra respuesta deja oculto', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await saveAnswer(
      draft.client_submission_id,
      'guarding.installed',
      false,
      TEST_DOCUMENT,
      database,
    );
    await saveAnswer(
      draft.client_submission_id,
      'guarding.reason',
      'Removed for maintenance',
      TEST_DOCUMENT,
      database,
    );
    await saveAnswer(
      draft.client_submission_id,
      'guarding.severity',
      'high',
      TEST_DOCUMENT,
      database,
    );

    expect(await database.answers.count()).toBe(3);

    // El inspector se corrige: ahora los guardas SÍ están, y los dos ítems que
    // dependían de que no lo estuvieran desaparecen.
    const { pruned } = await saveAnswer(
      draft.client_submission_id,
      'guarding.installed',
      true,
      TEST_DOCUMENT,
      database,
    );

    expect(pruned.sort()).toEqual(['guarding.reason', 'guarding.severity']);

    const loaded = await loadDraft(draft.client_submission_id, database);
    expect(loaded?.answers['guarding.reason']).toBeUndefined();
    expect(Object.keys(loaded?.answers ?? {})).toEqual(['guarding.installed']);
  });

  it('vaciar una respuesta la borra en vez de guardar una cadena en blanco', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await saveAnswer(
      draft.client_submission_id,
      'guarding.installed',
      false,
      TEST_DOCUMENT,
      database,
    );
    await saveAnswer(draft.client_submission_id, 'guarding.reason', 'algo', TEST_DOCUMENT, database);
    await saveAnswer(draft.client_submission_id, 'guarding.reason', '   ', TEST_DOCUMENT, database);

    const loaded = await loadDraft(draft.client_submission_id, database);
    expect(loaded?.answers['guarding.reason']).toBeUndefined();
  });

  /** Spec: "An accepted submission cannot be edited". */
  it('una inspección aceptada no admite respuestas nuevas ni genera otro borrador', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);
    await database.drafts.update(draft.client_submission_id, { status: 'accepted' });

    await expect(
      saveAnswer(draft.client_submission_id, 'guarding.installed', true, TEST_DOCUMENT, database),
    ).rejects.toThrow(/solo lectura/);

    const reopened = await openDraft(input(), database);
    expect(reopened.client_submission_id).toBe(draft.client_submission_id);
    expect(reopened.status).toBe('accepted');
    expect(await database.drafts.count()).toBe(1);
  });
});

describe('signDraft', () => {
  it('firma una vez y no re-firma una inspección ya aceptada', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    const signed = await signDraft(draft.client_submission_id, database);
    expect(signed.status).toBe('signed');
    expect(signed.signed_at).not.toBeNull();

    await database.drafts.update(draft.client_submission_id, { status: 'accepted' });
    const again = await signDraft(draft.client_submission_id, database);
    expect(again.status).toBe('accepted');
  });
});

describe('documentForDraft', () => {
  it('devuelve null cuando lo descargado es de otra versión que la congelada', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await database.prefetch.put({
      scheduled_inspection_id: INSPECTION_ID,
      kind: 'template_version',
      payload: {
        kind: 'template_version',
        site_id: 'site-1',
        template_version_id: '99999999-9999-4999-8999-999999999999',
        version: 3,
        document: TEST_DOCUMENT,
      },
      fetched_at: '2026-08-01T10:00:00.000Z',
    });

    expect(await documentForDraft(draft, database)).toBeNull();
  });

  it('devuelve el documento congelado cuando la versión coincide', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await database.prefetch.put({
      scheduled_inspection_id: INSPECTION_ID,
      kind: 'template_version',
      payload: {
        kind: 'template_version',
        site_id: 'site-1',
        template_version_id: VERSION_ID,
        version: 2,
        document: TEST_DOCUMENT,
      },
      fetched_at: '2026-08-01T10:00:00.000Z',
    });

    expect(await documentForDraft(draft, database)).toEqual(TEST_DOCUMENT);
  });
});

describe('setCurrentItem', () => {
  it('recuerda dónde quedó el inspector aunque no conteste', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await setCurrentItem(draft.client_submission_id, 'guarding.rating', database);
    database = await reopen(database);

    expect((await database.drafts.get(draft.client_submission_id))?.current_item_key).toBe(
      'guarding.rating',
    );
  });
});
