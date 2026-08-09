import type { TokenPair } from '@hs/contracts';
import { afterEach, describe, expect, it } from 'vitest';

import { freshDatabase, reopen } from '../test/database';
import { photoBlob, type OfflineDatabase } from './db';
import { dexieTokenStore } from './token-store';

let database: OfflineDatabase;

afterEach(() => {
  database?.close();
});

function draft(id: string) {
  return {
    client_submission_id: id,
    scheduled_inspection_id: 'inspection-1',
    account_id: 'account-a',
    site_id: 'site-1',
    template_version_id: 'version-2',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    current_item_key: null,
    status: 'capturing' as const,
    signed_at: null,
  };
}

describe('el almacén local', () => {
  it('escribe y lee un borrador con sus respuestas', async () => {
    database = freshDatabase();

    await database.drafts.put(draft('draft-1'));
    await database.answers.put({
      client_submission_id: 'draft-1',
      item_key: 'guarding.installed',
      value: true,
      answered_at: '2026-08-01T10:01:00.000Z',
    });

    const stored = await database.drafts.get('draft-1');
    const answers = await database.answers.where({ client_submission_id: 'draft-1' }).toArray();

    expect(stored?.template_version_id).toBe('version-2');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.value).toBe(true);
  });

  it('sobrevive a cerrar y reabrir la base', async () => {
    database = freshDatabase();
    await database.drafts.put(draft('draft-1'));

    database = await reopen(database);

    expect((await database.drafts.get('draft-1'))?.client_submission_id).toBe('draft-1');
  });

  /**
   * La atomicidad es lo que hace que "Android mató el proceso a mitad de un `put`"
   * cueste a lo sumo la respuesta en curso: no queda media respuesta ni un borrador
   * actualizado sin su respuesta.
   */
  it('una transacción interrumpida no deja media respuesta', async () => {
    database = freshDatabase();
    await database.drafts.put(draft('draft-1'));

    await expect(
      database.transaction('rw', database.answers, database.drafts, async () => {
        await database.answers.put({
          client_submission_id: 'draft-1',
          item_key: 'guarding.installed',
          value: true,
          answered_at: '2026-08-01T10:01:00.000Z',
        });

        await database.drafts.update('draft-1', { current_item_key: 'guarding.installed' });

        throw new Error('el proceso muere acá');
      }),
    ).rejects.toThrow('el proceso muere acá');

    expect(await database.answers.count()).toBe(0);
    expect((await database.drafts.get('draft-1'))?.current_item_key).toBeNull();
  });

  it('guarda los bytes de una foto y los devuelve enteros al reabrir', async () => {
    database = freshDatabase();
    const bytes = await new Blob(['bytes de una foto']).arrayBuffer();

    await database.photos.put({
      id: 'photo-1',
      client_submission_id: 'draft-1',
      item_key: 'guarding.photo',
      bytes,
      content_type: 'image/jpeg',
      object_key: null,
      upload_state: 'pending',
      attempts: 0,
      last_error: null,
      captured_at: '2026-08-01T10:02:00.000Z',
    });

    database = await reopen(database);

    const stored = await database.photos.get('photo-1');
    expect(stored).toBeDefined();
    expect(await photoBlob(stored!).text()).toBe('bytes de una foto');
    expect(photoBlob(stored!).type).toBe('image/jpeg');
  });
});

describe('dexieTokenStore', () => {
  const tokens: TokenPair = {
    accessToken: 'access',
    refreshToken: 'refresh',
    accessExpiresAt: '2026-08-01T11:00:00.000Z',
    refreshExpiresAt: '2026-08-08T10:00:00.000Z',
  };

  it('guarda y devuelve el par de tokens', async () => {
    database = freshDatabase();
    const store = dexieTokenStore(database);

    await store.write(tokens);

    expect(await store.read()).toEqual(tokens);
  });

  /** Cerrar sesión borra el token y NADA más: la cola es del inspector. */
  it('borrar el token no toca el borrador ni el outbox', async () => {
    database = freshDatabase();
    const store = dexieTokenStore(database);

    await store.write(tokens);
    await database.drafts.put(draft('draft-1'));
    await database.outbox.put({
      client_submission_id: 'draft-1',
      state: 'queued',
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
      sending_since: null,
      lock_owner: null,
    });

    await store.write(null);

    expect(await store.read()).toBeNull();
    expect(await database.drafts.count()).toBe(1);
    expect(await database.outbox.count()).toBe(1);
  });
});
