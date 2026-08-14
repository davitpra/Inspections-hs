import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const request = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({ sessionClient: { request } }));

const { get, post, send } = await import('./request');

/**
 * Lo que se prueba acá es el header, y no es un detalle de forma.
 *
 * `SessionClient.request` no pone `content-type` —es transporte, no sabe qué viaja— y
 * `fetch` con un body string rotula `text/plain`, que Nest no parsea: el controlador
 * recibe un objeto vacío y su Zod contesta 400 con todos los campos en `undefined`. Eso
 * es exactamente lo que le pasaba a `POST /reports/compliance`, la única llamada escrita
 * a mano fuera de un helper.
 *
 * Ningún test de ruta puede ver esto: todos mockean el módulo de `api/` entero. Tiene que
 * probarse acá, contra el cliente de sesión, o no se prueba en ningún lado.
 */
describe('el cliente HTTP', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockResolvedValue({ ok: true, value: { id: 'x' } });
  });

  const parse = (value: unknown): { id: string } => z.object({ id: z.string() }).parse(value);

  it('manda content-type: application/json en toda escritura', async () => {
    await send('POST', '/reports/compliance', { site_id: 'a' }, parse);

    expect(request).toHaveBeenCalledWith('/reports/compliance', {
      method: 'POST',
      body: JSON.stringify({ site_id: 'a' }),
      headers: { 'content-type': 'application/json' },
    });
  });

  it('lo manda también en PATCH y a través de post()', async () => {
    await send('PATCH', '/people/1', { first_name: 'A' }, parse);
    await post('/actions/1/transitions', { to: 'closed' }, parse);

    for (const [, init] of request.mock.calls) {
      expect(init.headers).toEqual({ 'content-type': 'application/json' });
    }
  });

  it('una lectura no manda body ni init', async () => {
    await get('/people?site_id=a', parse);

    expect(request).toHaveBeenCalledWith('/people?site_id=a');
  });

  it('parsea contra el contrato en vez de castear', async () => {
    request.mockResolvedValue({ ok: true, value: { id: 7 } });

    await expect(get('/x', parse)).rejects.toThrow();
  });

  it('convierte el fallo en excepción, que es lo que TanStack Query espera', async () => {
    request.mockResolvedValue({ ok: false, code: 'forbidden', message: 'No podés' });

    await expect(get('/x', parse)).rejects.toThrow('No podés');
  });
});
