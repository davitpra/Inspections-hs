import { describe, expect, it, vi } from 'vitest';
import type { TokenPair } from '@hs/contracts';

import { SessionClient, type TokenStore } from './session-client';

/**
 * ADR-011 — Lo que este spec protege es el requisito offline y nada más: que un 401
 * sobre un envío diferido termine en un reintento y nunca en una pérdida.
 *
 * Los tres desenlaces de design D5 se prueban por el CÓDIGO que devuelve el cliente,
 * no por el status: es exactamente la distinción que el outbox de la etapa 3 va a
 * consumir para decidir entre reintentar y pedir login.
 */

function tokens(overrides: Partial<TokenPair> = {}): TokenPair {
  return {
    accessToken: 'access-1',
    accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    refreshToken: 'refresh-1',
    refreshExpiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
}

function memoryStore(initial: TokenPair | null = tokens()): TokenStore {
  let current = initial;

  return {
    read: async () => current,
    write: async (next) => {
      current = next;
    },
  };
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('el cliente de sesión', () => {
  it('renueva y REINTENTA cuando el token venció', async () => {
    const calls: string[] = [];

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      calls.push(path);

      if (path.endsWith('/auth/refresh')) return json(200, { tokens: tokens({ accessToken: 'access-2' }) });

      // El primer intento vence; el segundo, ya con el token nuevo, pasa.
      return calls.filter((c) => c.endsWith('/inspections')).length === 1
        ? json(401, { code: 'token_expired', message: 'expired' })
        : json(200, { id: 'created' });
    });

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store: memoryStore(),
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });

    const result = await client.request<{ id: string }>('/inspections', { method: 'POST' });

    expect(result).toEqual({ ok: true, value: { id: 'created' } });
    expect(calls.filter((c) => c.endsWith('/inspections'))).toHaveLength(2);
    expect(calls).toContain('https://api.test/auth/refresh');
  });

  it('una sesión terminada se reporta como FINAL, sin pedir un refresh inútil', async () => {
    const fetchImpl = vi.fn(async () => json(401, { code: 'session_ended', message: 'gone' }));
    const onSessionEnded = vi.fn();

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store: memoryStore(),
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      onSessionEnded,
    });

    const result = await client.request('/inspections', { method: 'POST' });

    expect(result).toEqual({ ok: false, code: 'session_ended', message: 'gone' });
    expect(onSessionEnded).toHaveBeenCalledOnce();
    // Un solo request: no se intenta refrescar lo que ya no es renovable.
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  /**
   * REGRESIÓN. Un `404` de una ruta que todavía no existe no lleva código tipado, así
   * que `readError` cae en `session_ended` — y eso está bien para la cola, que no
   * descarta nada. Lo que NO puede pasar es que desloguee al inspector: se vio de
   * verdad, con `POST /inspection-submissions` sin implementar, sacando al usuario de su
   * recorrido al reconectar.
   */
  it('un error sin código tipado NO termina la sesión', async () => {
    for (const status of [404, 500, 502]) {
      const fetchImpl = vi.fn(async () => json(status, { message: 'Cannot POST' }));
      const onSessionEnded = vi.fn();

      const client = new SessionClient({
        baseUrl: 'https://api.test',
        store: memoryStore(),
        fetch: fetchImpl as unknown as typeof globalThis.fetch,
        onSessionEnded,
      });

      const result = await client.request('/inspection-submissions', { method: 'POST' });

      // Sigue reportándose como no-descartable para quien llama…
      expect(result.ok).toBe(false);
      // …pero la sesión no se da por terminada.
      expect(onSessionEnded).not.toHaveBeenCalled();
    }
  });

  it('un 403 no refresca ni reintenta', async () => {
    const fetchImpl = vi.fn(async () => json(403, { code: 'forbidden', message: 'no' }));

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store: memoryStore(),
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });

    const result = await client.request('/inspections');

    expect(result).toEqual({ ok: false, code: 'forbidden', message: 'no' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('un error sin código tipado se trata como NO renovable, que es el lado seguro', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>502</html>', { status: 502 }));

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store: memoryStore(),
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });

    const result = await client.request('/inspections');

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('ensureFreshSession refresca ANTES de que el outbox mande nada', async () => {
    const fetchImpl = vi.fn(async () => json(200, { tokens: tokens({ accessToken: 'access-2' }) }));

    const store = memoryStore(tokens({ accessExpiresAt: new Date(Date.now() + 5_000).toISOString() }));

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store,
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(await client.ensureFreshSession()).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect((await store.read())?.accessToken).toBe('access-2');
  });

  it('no refresca si el token todavía tiene vida', async () => {
    const fetchImpl = vi.fn();

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store: memoryStore(),
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });

    expect(await client.ensureFreshSession()).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('un refresh vencido devuelve false y NO toca lo que el dispositivo tenga en cola', async () => {
    const fetchImpl = vi.fn(async () => json(401, { code: 'session_ended', message: 'gone' }));
    const onSessionEnded = vi.fn();

    const store = memoryStore(tokens({ accessExpiresAt: new Date(Date.now() - 1000).toISOString() }));

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store,
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
      onSessionEnded,
    });

    expect(await client.ensureFreshSession()).toBe(false);
    expect(onSessionEnded).toHaveBeenCalledOnce();
    // Lo único que borra es su propio token: la cola es del outbox y no de este cliente.
    expect(await store.read()).toBeNull();
  });

  it('tres requests que vencen juntos disparan UN solo refresh', async () => {
    let refreshes = 0;

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith('/auth/refresh')) {
        refreshes += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return json(200, { tokens: tokens({ accessToken: 'access-2' }) });
      }

      return json(200, { ok: true });
    });

    const client = new SessionClient({
      baseUrl: 'https://api.test',
      store: memoryStore(tokens({ accessExpiresAt: new Date(Date.now() + 1000).toISOString() })),
      fetch: fetchImpl as unknown as typeof globalThis.fetch,
    });

    await Promise.all([
      client.ensureFreshSession(),
      client.ensureFreshSession(),
      client.ensureFreshSession(),
    ]);

    // Si fueran tres, dos llegarían con el token ya gastado y la detección de reuso
    // del servidor echaría al usuario por hacer las cosas bien.
    expect(refreshes).toBe(1);
  });
});
