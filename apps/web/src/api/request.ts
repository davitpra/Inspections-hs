import { sessionClient } from './client';
import type { AuthedResult } from '../auth/session-client';

/**
 * Las dos formas de hablarle a la API, y las únicas.
 *
 * **Todo lo que vuelve se parsea contra el contrato, no se castea**: un campo que el
 * servidor tenga y el cliente no —un despliegue a medias— falla donde alguien lo ve, en
 * vez de pintar una fila incompleta. Por eso `parse` es un parámetro obligatorio y no un
 * genérico con default: no hay forma de llamar a esto y quedarse con un `unknown` casteado.
 *
 * **`send` pone `content-type: application/json` para objetos JSON.**
 * `SessionClient.request` no lo agrega —es transporte, no sabe qué viaja—, y
 * `fetch` con un body de tipo string rotula `text/plain`, que Nest no parsea: el handler
 * recibe un objeto vacío y el Zod del controlador contesta 400 con todos los campos en
 * `undefined`. Los tests de integración no lo veían porque
 * supertest pone el header solo.
 *
 * `FormData` pasa intacto y sin `content-type`: el navegador tiene que escribir el boundary.
 */

export class RequestError extends Error {
  constructor(
    message: string,
    readonly code?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RequestError';
  }
}

async function request<T>(operation: () => Promise<AuthedResult<T>>): Promise<T> {
  try {
    const result = await operation();

    if (!result.ok) throw new RequestError(result.message, result.code);

    return result.value;
  } catch (error) {
    if (error instanceof RequestError) throw error;

    throw new RequestError(error instanceof Error ? error.message : 'Network request failed', undefined, {
      cause: error,
    });
  }
}

export async function get<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  return parse(await request(() => sessionClient.request<unknown>(path)));
}

export async function send<T>(
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown | FormData,
  parse: (value: unknown) => T,
): Promise<T> {
  const init: RequestInit = body instanceof FormData
    ? { method, body }
    : {
        method,
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      };

  return parse(await request(() => sessionClient.request<unknown>(path, init)));
}

/**
 * `PUT` está en la unión desde la autoría de plantillas: un borrador se guarda entero, no
 * por partes, y `PATCH` habría prometido un parche que el servidor no acepta.
 */

/** `send('POST', …)` con menos ruido, que es la mayoría de los casos. */
export async function post<T>(
  path: string,
  body: unknown,
  parse: (value: unknown) => T,
): Promise<T> {
  return send('POST', path, body, parse);
}
