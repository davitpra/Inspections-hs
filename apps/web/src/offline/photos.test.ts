import { afterEach, describe, expect, it, vi } from 'vitest';

import { fakeSessionClient, ok } from '../test/fixtures';
import { freshDatabase, reopen } from '../test/database';
import { photoBlob, type OfflineDatabase } from './db';
import {
  capturePhoto,
  countPending,
  discardPhoto,
  photosOfDraft,
  uploadPendingPhotos,
  uploadPhoto,
  uploadedKeysByItem,
} from './photos';

const DRAFT_ID = '11111111-1111-4111-8111-111111111111';
const INSPECTION_ID = '22222222-2222-4222-8222-222222222222';

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

function jpeg(text: string): Blob {
  return new Blob([text], { type: 'image/jpeg' });
}

/** El servidor de presign: una key distinta por llamada. */
function presignServer() {
  let issued = 0;

  return fakeSessionClient({
    respond: (path) => {
      if (path !== '/uploads/presign') throw new Error(`path inesperado: ${path}`);

      issued += 1;

      return ok({
        url: `https://bucket.example.com/site/inspection/${issued}?X-Amz-Signature=abc`,
        object_key: `site/inspection/key-${issued}`,
        expires_at: new Date(Date.now() + 300_000).toISOString(),
      });
    },
  });
}

/** El PUT contra el bucket: falla el de la foto cuyo contenido diga `falla`. */
function bucket(failOn: string[] = []) {
  const puts: string[] = [];

  const put = vi.fn(async (url: string, blob: Blob) => {
    const text = await blob.text();
    puts.push(text);

    if (failOn.includes(text)) return new Response(null, { status: 500 });

    return new Response(null, { status: 200, headers: { location: url } });
  });

  return { put, puts };
}

describe('capturePhoto', () => {
  it('guarda el blob al tomarlo, sin red, y lo deja visible en el borrador', async () => {
    database = freshDatabase();

    const photo = await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('foto-1') },
      database,
    );

    expect(photo.upload_state).toBe('pending');
    expect(photo.object_key).toBeNull();

    database = await reopen(database);

    const stored = await photosOfDraft(DRAFT_ID, database);
    expect(stored).toHaveLength(1);
    expect(await photoBlob(stored[0]!).text()).toBe('foto-1');
  });
});

describe('uploadPhoto', () => {
  it('pide presign, hace el PUT y guarda la object key', async () => {
    database = freshDatabase();
    const client = presignServer();
    const { put } = bucket();

    const photo = await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('foto-1') },
      database,
    );

    const uploaded = await uploadPhoto(photo.id, INSPECTION_ID, { database, client, put });

    expect(uploaded?.upload_state).toBe('uploaded');
    expect(uploaded?.object_key).toBe('site/inspection/key-1');
    expect(put).toHaveBeenCalledTimes(1);
  });

  /** Spec: "An uploaded photo is not uploaded twice". */
  it('una foto ya subida no vuelve a pedir presign ni a subir', async () => {
    database = freshDatabase();
    const client = presignServer();
    const { put } = bucket();

    const photo = await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('foto-1') },
      database,
    );

    await uploadPhoto(photo.id, INSPECTION_ID, { database, client, put });
    await uploadPhoto(photo.id, INSPECTION_ID, { database, client, put });
    await uploadPhoto(photo.id, INSPECTION_ID, { database, client, put });

    expect(client.calls).toHaveLength(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('un fallo se guarda en la foto y no rompe la llamada', async () => {
    database = freshDatabase();
    const photo = await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('falla') },
      database,
    );

    const failed = await uploadPhoto(photo.id, INSPECTION_ID, {
      database,
      client: presignServer(),
      put: bucket(['falla']).put,
    });

    expect(failed?.upload_state).toBe('failed');
    expect(failed?.attempts).toBe(1);
    expect(failed?.last_error).toContain('500');
  });
});

describe('uploadPendingPhotos', () => {
  /** Spec: "One failed photo does not block the others". */
  it('cinco fotos con una que falla suben cuatro y reintentan la quinta sin re-capturarla', async () => {
    database = freshDatabase();
    const client = presignServer();

    for (const name of ['a', 'b', 'falla', 'd', 'e']) {
      await capturePhoto(
        { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg(name) },
        database,
      );
    }

    const failing = bucket(['falla']);
    const pending = await uploadPendingPhotos(DRAFT_ID, INSPECTION_ID, {
      database,
      client,
      put: failing.put,
    });

    expect(pending).toBe(1);
    expect(countPending(await photosOfDraft(DRAFT_ID, database))).toBe(1);

    // La corrida siguiente, con el bucket sano: la quinta sube y NO se re-captura —
    // sigue siendo la misma fila, con sus mismos bytes.
    const idsBefore = (await photosOfDraft(DRAFT_ID, database)).map((photo) => photo.id);
    const healthy = bucket();
    const stillPending = await uploadPendingPhotos(DRAFT_ID, INSPECTION_ID, {
      database,
      client,
      put: healthy.put,
    });

    expect(stillPending).toBe(0);
    expect(healthy.puts).toEqual(['falla']);
    expect((await photosOfDraft(DRAFT_ID, database)).map((photo) => photo.id)).toEqual(idsBefore);
  });

  it('una corrida sobre fotos ya subidas es idempotente: no sube nada', async () => {
    database = freshDatabase();
    const client = presignServer();
    const first = bucket();

    for (const name of ['a', 'b']) {
      await capturePhoto(
        { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg(name) },
        database,
      );
    }

    await uploadPendingPhotos(DRAFT_ID, INSPECTION_ID, { database, client, put: first.put });

    const second = bucket();
    await uploadPendingPhotos(DRAFT_ID, INSPECTION_ID, { database, client, put: second.put });

    expect(first.puts).toEqual(['a', 'b']);
    expect(second.puts).toEqual([]);
    expect(client.calls).toHaveLength(2);
  });
});

describe('uploadedKeysByItem', () => {
  it('agrupa las object keys por item_key, y solo las subidas', async () => {
    database = freshDatabase();
    const client = presignServer();
    const { put } = bucket(['falla']);

    await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('a') },
      database,
    );
    await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('falla') },
      database,
    );

    await uploadPendingPhotos(DRAFT_ID, INSPECTION_ID, { database, client, put });

    expect(await uploadedKeysByItem(DRAFT_ID, database)).toEqual({
      'guarding.photo': ['site/inspection/key-1'],
    });
  });
});

describe('discardPhoto', () => {
  it('borra una foto sin subir y NO borra una ya subida', async () => {
    database = freshDatabase();
    const client = presignServer();
    const { put } = bucket();

    const pending = await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('a') },
      database,
    );
    const sent = await capturePhoto(
      { client_submission_id: DRAFT_ID, item_key: 'guarding.photo', blob: jpeg('b') },
      database,
    );

    await uploadPhoto(sent.id, INSPECTION_ID, { database, client, put });

    await discardPhoto(pending.id, database);
    await discardPhoto(sent.id, database);

    const remaining = await photosOfDraft(DRAFT_ID, database);
    expect(remaining.map((photo) => photo.id)).toEqual([sent.id]);
  });
});
