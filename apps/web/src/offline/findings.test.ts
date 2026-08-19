import { afterEach, describe, expect, it } from 'vitest';

import { TEST_DOCUMENT } from '../test/fixtures';
import { freshDatabase, reopen } from '../test/database';
import type { OfflineDatabase } from './db';
import {
  IncompleteFindingsError,
  incompleteFindings,
  loadDraft,
  openDraft,
  saveAnswer,
  saveFinding,
  signDraft,
} from './drafts';
import { capturePhoto } from './photos';

/**
 * Requisitos §3 R2 en el dispositivo: qué pasa cuando el inspector responde que no.
 *
 * La regla de qué respuesta es negativa NO se prueba acá: es de `@hs/forms` y tiene su
 * propia tabla de casos, que además corre en el servidor. Acá se prueba lo que es del
 * dispositivo — que la fila aparezca, que se escriba en el acto, que se descarte con su
 * respuesta, y que no se pueda firmar hasta que esté completa.
 */

const INSPECTION_ID = '11111111-1111-4111-8111-111111111111';
const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = 'account-a';

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

function input() {
  return {
    scheduled_inspection_id: INSPECTION_ID,
    account_id: ACCOUNT,
    site_id: 'site-1',
    template_version_id: VERSION_ID,
  };
}

async function draftWithNegative() {
  const draft = await openDraft(input(), database);

  await saveAnswer(draft.client_submission_id, 'guarding.installed', false, TEST_DOCUMENT, database);

  return draft.client_submission_id;
}

async function complete(id: string) {
  await saveFinding(
    id,
    'guarding.installed',
    { description: 'Guard missing on the infeed of line 3', location_id: LOCATION_ID },
    database,
  );

  await capturePhoto(
    {
      client_submission_id: id,
      item_key: 'guarding.installed',
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' }),
      kind: 'finding',
    },
    database,
  );
}

describe('la fila del hallazgo', () => {
  it('aparece al responder que no, vacía', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    const loaded = await loadDraft(id, database);

    expect(loaded?.findings).toEqual([
      expect.objectContaining({ item_key: 'guarding.installed', description: '', location_id: null }),
    ]);
  });

  it('no aparece para una respuesta afirmativa', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await saveAnswer(draft.client_submission_id, 'guarding.installed', true, TEST_DOCUMENT, database);

    const loaded = await loadDraft(draft.client_submission_id, database);

    expect(loaded?.findings).toEqual([]);
  });

  /** `na` es una tercera respuesta, no una falla (§4). */
  it('no aparece para un na', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await saveAnswer(draft.client_submission_id, 'guarding.applies', 'na', TEST_DOCUMENT, database);

    const loaded = await loadDraft(draft.client_submission_id, database);

    expect(loaded?.findings).toEqual([]);
  });

  it('sobrevive al cierre de la aplicación con su descripción, su ubicación y su foto', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    database = await reopen(database);
    const loaded = await loadDraft(id, database);

    expect(loaded?.findings[0]).toMatchObject({
      description: 'Guard missing on the infeed of line 3',
      location_id: LOCATION_ID,
    });
    expect(loaded?.photos.filter((photo) => photo.kind === 'finding')).toHaveLength(1);
  });

  it('se descarta al corregir la respuesta, junto con sus fotos', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    await saveAnswer(id, 'guarding.installed', true, TEST_DOCUMENT, database);

    const loaded = await loadDraft(id, database);

    expect(loaded?.findings).toEqual([]);
    expect(loaded?.photos.filter((photo) => photo.kind === 'finding')).toEqual([]);
  });

  it('no se puede describir un hallazgo que ninguna respuesta implica', async () => {
    database = freshDatabase();
    const draft = await openDraft(input(), database);

    await expect(
      saveFinding(
        draft.client_submission_id,
        'guarding.installed',
        { description: 'algo' },
        database,
      ),
    ).rejects.toThrow(/no tiene una respuesta negativa/);
  });
});

describe('incompleteFindings', () => {
  it('nombra qué le falta a cada ítem', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    const loaded = await loadDraft(id, database);

    expect(
      incompleteFindings(TEST_DOCUMENT, loaded!.answers, loaded!.findings, loaded!.photos),
    ).toEqual([
      { item_key: 'guarding.installed', missing: ['description', 'photo'] },
    ]);
  });

  it('un hallazgo completo no aparece', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    const loaded = await loadDraft(id, database);

    expect(
      incompleteFindings(TEST_DOCUMENT, loaded!.answers, loaded!.findings, loaded!.photos),
    ).toEqual([]);
  });

  it('una descripción de espacios no cuenta como descripción', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    await saveFinding(id, 'guarding.installed', { description: '   ' }, database);

    const loaded = await loadDraft(id, database);

    expect(
      incompleteFindings(TEST_DOCUMENT, loaded!.answers, loaded!.findings, loaded!.photos)[0]
        ?.missing,
    ).toEqual(['description']);
  });

  /**
   * La regresión que motivó el arreglo: "ok" pasaba la compuerta, pasaba la firma, y el
   * servidor lo rechazaba con un `ZodError` que salía como `500` y dejaba la entrada del
   * outbox reintentando para siempre.
   */
  it('una descripción más corta que el mínimo del contrato tampoco alcanza', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    await saveFinding(id, 'guarding.installed', { description: 'ok' }, database);

    const loaded = await loadDraft(id, database);

    expect(
      incompleteFindings(TEST_DOCUMENT, loaded!.answers, loaded!.findings, loaded!.photos)[0]
        ?.missing,
    ).toEqual(['description_too_short']);
  });
});

describe('signDraft con hallazgos', () => {
  it('se niega mientras un hallazgo esté incompleto, y nombra el ítem', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await expect(signDraft(id, database)).rejects.toBeInstanceOf(IncompleteFindingsError);

    const loaded = await loadDraft(id, database);

    expect(loaded?.draft.status).toBe('capturing');
  });

  it('se niega con una descripción demasiado corta, aunque no esté vacía', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    await saveFinding(id, 'guarding.installed', { description: 'ok' }, database);

    await expect(signDraft(id, database)).rejects.toBeInstanceOf(IncompleteFindingsError);

    const loaded = await loadDraft(id, database);

    expect(loaded?.draft.status).toBe('capturing');
  });

  it('firma cuando cada respuesta negativa tiene sus tres datos', async () => {
    database = freshDatabase();
    const id = await draftWithNegative();

    await complete(id);
    const signed = await signDraft(id, database);

    expect(signed.status).toBe('signed');
    expect(signed.signed_at).not.toBeNull();
  });
});
