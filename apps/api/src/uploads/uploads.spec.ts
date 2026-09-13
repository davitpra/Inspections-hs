import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { ObjectStorageService, deriveObjectKey } from './object-storage';
import { UploadsService } from './uploads.service';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SITE_ID = '99999999-9999-4999-8999-999999999999';
const INSPECTION_ID = '22222222-2222-4222-8222-222222222222';
const USER_ID = '33333333-3333-4333-8333-333333333333';
const EVIDENCE_ID = '44444444-4444-4444-8444-444444444444';
const EVIDENCE_KEY = `${SITE_ID}/actions/${INSPECTION_ID}/evidence`;

const session: SessionScope = {
  userId: USER_ID,
  siteIds: [SITE_ID],
  role: 'inspector',
};

const request = {
  scheduled_inspection_id: INSPECTION_ID,
  item_key: 'guarding.photo',
  content_type: 'image/jpeg',
  content_length: 900_000,
} as const;

/**
 * El doble de la base devuelve lo que la política RLS haría devolver: las filas que la
 * transacción VE. Una inspección fuera del alcance no es una fila filtrada acá — es una
 * fila que la consulta no trae, y el doble modela exactamente eso.
 */
function dbReturning(rows: { site_id: string }[]): DbService {
  return {
    withSessionClient: async <T>(
      _session: SessionScope,
      run: (client: { query: () => Promise<{ rows: { site_id: string }[] }> }) => Promise<T>,
    ): Promise<T> => run({ query: async () => ({ rows }) }),
  } as unknown as DbService;
}

function storageSpy() {
  const presignPut = vi.fn(async () => ({
    url: 'https://bucket.example.com/signed',
    object_key: `${SITE_ID}/${INSPECTION_ID}/abc`,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  }));

  return { presignPut } as unknown as ObjectStorageService & { presignPut: typeof presignPut };
}

function evidenceStorageSpy() {
  const presignGet = vi.fn(async (objectKey: string) => ({
    url: 'https://bucket.example.com/signed-get',
    object_key: objectKey,
    expires_at: new Date(Date.now() + 300_000).toISOString(),
  }));

  return { presignGet } as unknown as ObjectStorageService & { presignGet: typeof presignGet };
}

describe('UploadsService.presign', () => {
  it('firma una subida para una inspección dentro del alcance', async () => {
    const storage = storageSpy();
    const service = new UploadsService(dbReturning([{ site_id: SITE_ID }]), storage);

    const response = await service.presign(session, request);

    expect(response.object_key.startsWith(`${SITE_ID}/${INSPECTION_ID}/`)).toBe(true);
    // El `site_id` que se firma sale de la FILA, no del pedido: el cliente no tiene
    // forma de nombrar la planta bajo la que escribe.
    expect(storage.presignPut).toHaveBeenCalledWith(
      expect.objectContaining({ site_id: SITE_ID, scheduled_inspection_id: INSPECTION_ID }),
    );
  });

  /** Spec: "A presigned URL is scoped to the requester". */
  it('rechaza con 403 una inspección fuera del alcance y no emite URL', async () => {
    const storage = storageSpy();
    const service = new UploadsService(dbReturning([]), storage);

    await expect(service.presign(session, request)).rejects.toMatchObject({ status: 403 });
    expect(storage.presignPut).not.toHaveBeenCalled();
  });

  /**
   * D7 — una key propuesta por el cliente se ignora. El `strictObject` del contrato la
   * rechaza en el borde; acá se comprueba lo que importa aunque alguien lo saltara: el
   * servicio no lee nada del pedido para armar la key.
   */
  it('ignora una object key propuesta por el cliente', async () => {
    const storage = storageSpy();
    const service = new UploadsService(dbReturning([{ site_id: SITE_ID }]), storage);

    await service.presign(session, {
      ...request,
      object_key: `${OTHER_SITE_ID}/robada/mia.jpg`,
    } as never);

    expect(storage.presignPut).toHaveBeenCalledWith(
      expect.not.objectContaining({ object_key: expect.anything() }),
    );
  });
});

describe('deriveObjectKey', () => {
  it('prefija por sitio y por inspección, y no colisiona', () => {
    const first = deriveObjectKey(SITE_ID, INSPECTION_ID);
    const second = deriveObjectKey(SITE_ID, INSPECTION_ID);

    expect(first.startsWith(`${SITE_ID}/${INSPECTION_ID}/`)).toBe(true);
    expect(first).not.toBe(second);
  });
});

describe('UploadsService.getActionEvidence', () => {
  it('firma la key de una evidencia visible dentro del alcance', async () => {
    const query = vi.fn(async () => ({ rows: [{ object_key: EVIDENCE_KEY }] }));
    const withSessionClient = vi.fn(async (_session, run) => run({ query }));
    const db = { withSessionClient } as unknown as DbService;
    const storage = evidenceStorageSpy();
    const service = new UploadsService(db, storage);

    const response = await service.getActionEvidence(session, EVIDENCE_ID);

    expect(response.object_key).toBe(EVIDENCE_KEY);
    expect(withSessionClient).toHaveBeenCalledWith(session, expect.any(Function));
    expect(query).toHaveBeenCalledWith(
      expect.not.stringMatching(/site_id/i),
      [EVIDENCE_ID],
    );
    expect(storage.presignGet).toHaveBeenCalledWith(EVIDENCE_KEY);
  });

  it('rechaza con 403 una evidencia fuera del alcance sin revelar ni firmar su key', async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const db = {
      withSessionClient: async (_session: SessionScope, run: (client: { query: typeof query }) => Promise<unknown>) =>
        run({ query }),
    } as unknown as DbService;
    const storage = evidenceStorageSpy();
    const service = new UploadsService(db, storage);

    await expect(service.getActionEvidence(session, EVIDENCE_ID)).rejects.toMatchObject({
      status: 403,
      response: expect.not.objectContaining({ object_key: expect.anything(), url: expect.anything() }),
    });
    expect(storage.presignGet).not.toHaveBeenCalled();
  });
});

describe('ObjectStorageService', () => {
  beforeEach(() => {
    vi.stubEnv('S3_BUCKET', 'hs-platform-test');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'test-key');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_UPLOAD_TTL_SECONDS', '300');
  });

  it('no arranca sin bucket ni credencial', () => {
    vi.stubEnv('S3_BUCKET', '');

    expect(() => new ObjectStorageService()).toThrow(/S3_BUCKET/);
  });

  it('emite una URL firmada que expira', async () => {
    const before = Date.now();
    const signed = await new ObjectStorageService().presignPut({
      site_id: SITE_ID,
      scheduled_inspection_id: INSPECTION_ID,
      content_type: 'image/jpeg',
      content_length: 900_000,
    });

    const url = new URL(signed.url);

    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.pathname).toContain(signed.object_key);

    const expiresAt = Date.parse(signed.expires_at);
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThanOrEqual(before + 300_000 + 5_000);
  });

  it('firma una lectura GET para la key recibida con el TTL configurado', async () => {
    const before = Date.now();
    const signed = await new ObjectStorageService().presignGet(EVIDENCE_KEY);
    const url = new URL(signed.url);

    expect(url.searchParams.get('X-Amz-Expires')).toBe('300');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('x-id')).toBe('GetObject');
    expect(url.pathname).toContain(EVIDENCE_KEY);
    expect(signed.object_key).toBe(EVIDENCE_KEY);

    const expiresAt = Date.parse(signed.expires_at);
    expect(expiresAt).toBeGreaterThan(before);
    expect(expiresAt).toBeLessThanOrEqual(before + 300_000 + 5_000);
  });
});
