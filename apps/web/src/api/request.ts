import { sessionClient } from './client';

/**
 * Las dos formas de hablarle a la API, y las únicas.
 *
 * **Todo lo que vuelve se parsea contra el contrato, no se castea**: un campo que el
 * servidor tenga y el cliente no —un despliegue a medias— falla donde alguien lo ve, en
 * vez de pintar una fila incompleta. Por eso `parse` es un parámetro obligatorio y no un
 * genérico con default: no hay forma de llamar a esto y quedarse con un `unknown` casteado.
 *
 * **`send` pone `content-type: application/json` siempre, y esa es la mitad de su razón de
 * existir.** `SessionClient.request` no lo agrega —es transporte, no sabe qué viaja—, y
 * `fetch` con un body de tipo string rotula `text/plain`, que Nest no parsea: el handler
 * recibe un objeto vacío y el Zod del controlador contesta 400 con todos los campos en
 * `undefined`. Los tests de integración no lo veían porque
 * supertest pone el header solo.
 *
 * El error se convierte en `Error(message)` y se pierde el `code`, que es lo que estas
 * pantallas quieren: TanStack Query necesita una excepción, y ninguna de ellas distingue
 * un código de otro. Las que sí lo necesitan —iniciar sesión, aceptar una invitación— no
 * pasan por acá: viven en `SessionClient` y devuelven el `AuthedResult` entero.
 */

export async function get<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const result = await sessionClient.request<unknown>(path);

  if (!result.ok) throw new Error(result.message);

  return parse(result.value);
}

export async function send<T>(
  method: 'POST' | 'PATCH' | 'PUT',
  path: string,
  body: unknown,
  parse: (value: unknown) => T,
): Promise<T> {
  const result = await sessionClient.request<unknown>(path, {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

  if (!result.ok) throw new Error(result.message);

  return parse(result.value);
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
