import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const request = vi.hoisted(() => vi.fn());

vi.mock('./client', () => ({ sessionClient: { request } }));

const { get, post, RequestError, send } = await import('./request');

/**
 * Lo que se prueba acá es el header, y no es un detalle de forma.
 *
 * `SessionClient.request` no pone `content-type` —es transporte, no sabe qué viaja— y
 * `fetch` con un body string rotula `text/plain`, que Nest no parsea: el controlador
 * recibe un objeto vacío y su Zod contesta 400 con todos los campos en `undefined`. Eso
 * Esto protege todas las escrituras de la API, incluso cuando el controlador espera JSON.
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
    await send('POST', '/actions/1/transitions', { to: 'closed' }, parse);

    expect(request).toHaveBeenCalledWith('/actions/1/transitions', {
      method: 'POST',
      body: JSON.stringify({ to: 'closed' }),
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

  it('manda FormData intacto y deja que el navegador escriba el content-type', async () => {
    const body = new FormData();
    body.append('file', new File(['csv'], 'roster.csv'));

    await post('/people/import', body, parse);

    expect(request).toHaveBeenCalledWith('/people/import', { method: 'POST', body });
    expect(request.mock.calls[0]![1].headers).toBeUndefined();
  });

  it('una lectura no manda body ni init', async () => {
    await get('/people?site_id=a', parse);

    expect(request).toHaveBeenCalledWith('/people?site_id=a');
  });

  it('parsea contra el contrato en vez de castear', async () => {
    request.mockResolvedValue({ ok: true, value: { id: 7 } });

    await expect(get('/x', parse)).rejects.toThrow();
  });

  it('conserva el código y el mensaje de un fallo de dominio', async () => {
    request.mockResolvedValue({
      ok: false,
      code: 'roster_file_too_large',
      message: 'The file is too large',
    });

    const error = await get('/x', parse).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({
      code: 'roster_file_too_large',
      message: 'The file is too large',
    });
  });

  it('normaliza un fallo de red sin inventarle un código de dominio', async () => {
    const cause = new TypeError('Failed to fetch');
    request.mockRejectedValue(cause);

    const error = await get('/x', parse).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RequestError);
    expect(error).toMatchObject({ code: undefined, message: 'Failed to fetch', cause });
  });
});
