import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({ sessionClient: { request } }));

const { importRoster } = await import('./roster');

describe('importRoster', () => {
  beforeEach(() => request.mockReset());

  it('sube el archivo bajo file y parsea el reporte contra el contrato', async () => {
    const response = {
      import_id: '11111111-1111-4111-8111-111111111111',
      source_filename: 'people.csv',
      rows_read: 2,
      rows_applied: 1,
      rows_rejected: 1,
      rejections: [{ row_number: 3, employee_number: '2', reason: 'Unknown site code' }],
    };
    request.mockResolvedValue({ ok: true, value: response });
    const file = new File(['employee_number'], 'people.csv', { type: 'text/csv' });

    await expect(importRoster({ file })).resolves.toEqual(response);

    const [path, init] = request.mock.calls[0] as [string, RequestInit];
    const body = init.body as FormData;
    expect(path).toBe('/people/import');
    expect(init.method).toBe('POST');
    expect(init.headers).toBeUndefined();
    expect(body.getAll('file')).toEqual([file]);
    expect((body.get('file') as File).name).toBe('people.csv');
  });

  it('rechaza una respuesta que no cumple el schema', async () => {
    request.mockResolvedValue({ ok: true, value: { rows_read: '2' } });

    await expect(importRoster({ file: new File(['x'], 'people.csv') })).rejects.toThrow();
  });
});
