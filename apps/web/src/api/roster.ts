import {
  accountDetailSchema,
  createAccountResponseSchema,
  personWithAccountSchema,
  type AccountDetail,
  type CreateAccountResponse,
  type PersonWithAccount,
} from '@hs/contracts';
import { z } from 'zod';

import { get, post, send } from './request';

/**
 * El cliente de la consola del roster.
 *
 * Lo que vuelve se parsea contra el contrato (ver `request.ts`): un campo que el servidor
 * tenga y el cliente no —un despliegue a medias— falla donde alguien lo ve, en vez de
 * pintar una fila incompleta.
 *
 * ONLINE, y fuera de Dexie y del outbox: es una consulta de administración, y servirla
 * desde caché mostraría un roster viejo sin decir que lo es. El offline existe para que no
 * se pierda el trabajo de campo (ADR-001), y esto no es trabajo de campo.
 *
 * **Solo lectura sobre `person`.** Sigue sin haber `updatePerson` ni nada que la escriba:
 * el roster lo mantiene `pnpm roster:import`. Lo único que se agrega es dar de alta la
 * CUENTA de alguien que ya está en el roster (proposal — `POST /accounts`), que es otra
 * tabla y otra regla.
 */

/**
 * El roster de UNA planta, con la cuenta de cada persona o `null`.
 *
 * `site_id` es obligatorio del lado del servidor y acota la respuesta a doscientas filas,
 * que es lo que permite que la búsqueda de texto viva en el cliente y sea instantánea.
 *
 * Solo personas activas: la consola no ofrece un filtro de estado, así que nunca pide
 * `status` y se apoya en el default `active` del servidor (`rosterQuerySchema`).
 */
export async function listPeople(siteId: string): Promise<PersonWithAccount[]> {
  const query = new URLSearchParams({ site_id: siteId });

  return get(`/people?${query.toString()}`, (value) =>
    z.array(personWithAccountSchema).parse(value),
  );
}

/**
 * Invita a una persona como `jhsc_member` (design D4/D7): da de alta la cuenta y emite la
 * invitación en un solo `POST /accounts`, con el sitio que la pantalla ya está mirando. El
 * token de un solo uso viaja en la respuesta y en ningún otro lado.
 *
 * Sirve igual para quien nunca tuvo cuenta y para aquel a quien se le quitó el acceso
 * (`remove-jhsc-access-from-roster`): en el segundo caso el servidor revive la cuenta que
 * esa persona ya tenía —`person_id` es único, no hay una segunda que crear— sin que esta
 * función ni la pantalla tengan que distinguirlo.
 */
export async function inviteAsJhscMember(input: {
  personId: string;
  email: string;
  siteId: string;
}): Promise<CreateAccountResponse> {
  return post(
    '/accounts',
    {
      person_id: input.personId,
      email: input.email,
      role: 'jhsc_member',
      site_ids: [input.siteId],
      invite: true,
    },
    (value) => createAccountResponseSchema.parse(value),
  );
}

/**
 * El detalle administrable de UNA cuenta —con su email, que el roster nunca devuelve
 * (`personAccountSchema`, design D2)— para precargar el diálogo de reemisión
 * (`reissue-invitation-link-from-roster`, design D6). No es una segunda forma de leer el
 * roster: una cuenta a la vez, y solo la usa quien va a corregirla.
 */
export async function getAccount(userId: string): Promise<AccountDetail> {
  return get(`/accounts/${userId}`, (value) => accountDetailSchema.parse(value));
}

/**
 * Reemite el link de una cuenta que ya existe y todavía no puede entrar, corrigiendo su
 * email en el mismo acto si hace falta (design D5): el remedio de un token perdido,
 * vencido, o que nunca llegó porque el correo estaba mal escrito. El servidor revoca la
 * invitación pendiente de esa cuenta antes de emitir la nueva — nunca hay dos tokens
 * vivos a la vez — y rechaza la acción entera si la cuenta ya puede entrar.
 */
export async function reissueInvitation(input: {
  userId: string;
  email?: string;
}): Promise<CreateAccountResponse> {
  return send(
    'PATCH',
    `/accounts/${input.userId}`,
    { email: input.email, invite: true },
    (value) => createAccountResponseSchema.parse(value),
  );
}

/**
 * Quita el acceso de una cuenta del JHSC (`remove-jhsc-access-from-roster`). UNA sola
 * función para los dos casos que el coordinador vive como distintos —cancelar una
 * invitación que nadie aceptó, y sacar del comité a alguien que entra todos los días—
 * porque del lado del servidor son la misma escritura: se revoca la invitación pendiente
 * y la credencial, y la cuenta queda inactiva. Lo único que cambia es el texto con el que
 * la pantalla lo pregunta.
 *
 * No borra nada, y la persona sigue en el roster: perder el acceso no es irse de la
 * empresa.
 */
export async function removeJhscAccess(input: { userId: string }): Promise<CreateAccountResponse> {
  return send('PATCH', `/accounts/${input.userId}`, { deactivated: true }, (value) =>
    createAccountResponseSchema.parse(value),
  );
}

