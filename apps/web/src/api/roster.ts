import { personSchema, type Person } from '@hs/contracts';
import { z } from 'zod';

import { sessionClient } from './client';

/**
 * El cliente de la consola del roster.
 *
 * **Todo lo que vuelve se parsea contra el contrato, no se castea**: un campo que el
 * servidor tenga y el cliente no —un despliegue a medias— falla donde alguien lo ve, en
 * vez de pintar una fila incompleta.
 *
 * ONLINE, y fuera de Dexie y del outbox: es una consulta de administración, y servirla
 * desde caché mostraría un roster viejo sin decir que lo es. El offline existe para que no
 * se pierda el trabajo de campo (ADR-001), y esto no es trabajo de campo.
 *
 * **Solo lectura.** No hay `updatePerson` ni nada que escriba: el roster lo mantiene
 * `pnpm roster:import`.
 */

async function get<T>(path: string, parse: (value: unknown) => T): Promise<T> {
  const result = await sessionClient.request<unknown>(path);

  if (!result.ok) throw new Error(result.message);

  return parse(result.value);
}

export type RosterStatus = 'active' | 'inactive' | 'all';

/**
 * El roster de UNA planta.
 *
 * `site_id` es obligatorio del lado del servidor y acota la respuesta a doscientas filas,
 * que es lo que permite que la búsqueda de texto viva en el cliente y sea instantánea.
 */
export async function listPeople(siteId: string, status: RosterStatus): Promise<Person[]> {
  const query = new URLSearchParams({ site_id: siteId, status });

  return get(`/people?${query.toString()}`, (value) => z.array(personSchema).parse(value));
}
