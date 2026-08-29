import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({ sessionClient: { request } }));

const { listFindings } = await import('./findings');

const FINDING = {
  id: '11111111-1111-4111-8111-111111111111',
  site_id: '22222222-2222-4222-8222-222222222222',
  origin: 'manual',
  inspection_id: null,
  template_version_item_id: null,
  item_key: null,
  location_id: null,
  description: 'Unguarded pinch point beside the packing line',
  photo_object_keys: ['findings/photo.jpg'],
  reported_by: '33333333-3333-4333-8333-333333333333',
  occurred_at: '2026-08-27T14:00:00.000Z',
  recorded_at: '2026-08-27T14:05:00.000Z',
};

describe('listFindings', () => {
  beforeEach(() => request.mockReset());

  it('lee GET /findings y parsea la lista contra el contrato', async () => {
    request.mockResolvedValue({ ok: true, value: [FINDING] });

    await expect(listFindings()).resolves.toEqual([FINDING]);
    expect(request).toHaveBeenCalledWith('/findings');
  });

  it('rechaza una respuesta que no cumple el schema', async () => {
    request.mockResolvedValue({ ok: true, value: [{ ...FINDING, site_id: 'not-a-uuid' }] });

    await expect(listFindings()).rejects.toThrow();
  });
});
