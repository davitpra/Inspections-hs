import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import {
  isAdministrator,
  type AccountDetail,
  type CreateAccountRequest,
  type CreateAccountResponse,
  type Role,
  type UpdateAccountRequest,
} from '@hs/contracts';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import { asAdministrator } from './account-scope';
import { findAccountDetail, insertAccount } from './account.repository';
import {
  accountAlreadyActive,
  accountAlreadyExists,
  accountAlreadyInactive,
  accountDemotionForbidden,
  accountDemotionInactive,
  accountDemotionSelf,
  accountEmailTaken,
  accountForbidden,
  accountNotFound,
  accountOutOfScope,
  accountPersonNotFound,
  accountPromotionForbidden,
  accountPromotionInactive,
  accountPromotionSelf,
  accountRoleNotDemotable,
  accountRoleNotPromotable,
  accountRoleNotRemovable,
  type AccountException,
} from './account.errors';
import { revokeCredentials } from './credential.service';
import { InvitationService, revokePending } from './invitation.service';
import { SessionService } from './session.service';

/**
 * ADR-011, proposal — El alta de una cuenta sale por HTTP, con el mismo orden de INSERT
 * que ya hacía `pnpm auth:create-account` (design D6): los dos INSERT —tres cuando se
 * invita en el mismo acto, design D4— en LA MISMA transacción de `asAdministrator`, con
 * el actor de auditoría declarado, porque `hs_account_audit_fanout()` (0005 §8) está
 * diferido a COMMIT para encontrar el alcance ya otorgado.
 *
 * **NO CREA PERSONAS.** Si no está en el roster, entra por `pnpm roster:import`.
 *
 * El rol del actor se comprueba ACÁ (design D3), como `InvitationService.issue`; el
 * alcance no se comprueba en el servicio — la transacción declara el del actor y el
 * motor frena con HS002 si la cuenta nueva alcanza una planta que no tiene. Escribir
 * además un `if` sobre `site_ids` duplicaría la regla en el lugar donde se puede olvidar
 * de actualizarla.
 *
 * **`create()` también REVIVE** (`remove-jhsc-access-from-roster`): si la persona tiene una
   * cuenta dada de baja, dar de alta es devolverle la que ya tenía. `app_user.person_id` es
 * UNIQUE, así que no existe la opción de insertar una segunda — pero eso es un hecho del
 * motor y el cliente no tiene por qué conocerlo. Hay UN solo modo de decir "dale acceso a
 * esta persona", y de qué lado del `if` cae lo decide el servidor.
 */
@Injectable()
export class AccountService {
  constructor(
    private readonly db: DbService,
    private readonly invitations: InvitationService,
    private readonly sessions: SessionService,
  ) {}

  async create(
    actor: { userId: string; role: Role },
    request: CreateAccountRequest,
  ): Promise<CreateAccountResponse> {
    if (!isAdministrator(actor.role)) throw accountForbidden();

    return asAdministrator(this.db, actor.userId, async (client) => {
      // Bajo el alcance del actor: `person` lleva FORCE ROW LEVEL SECURITY, así que sin
      // este alcance declarado la tabla se ve vacía y "no existe" significaría "no
      // existe en ninguna planta del actor" para todo el mundo — que es, de hecho, la
      // respuesta correcta a dar sin romper el aislamiento.
      const person = await findPerson(client, request.person_id);
      if (!person) throw accountPersonNotFound();

      /**
       * La cuenta que esta persona ya tiene, si tiene alguna. `person_id` es UNIQUE, así
       * que es a lo sumo una — y de esa unicidad sale todo lo de abajo.
       */
      const existing = await findAccountOfPerson(client, request.person_id);

      // Excluyendo la fila que vuelve: una cuenta que se revive con el mismo correo que ya
      // tenía chocaría contra sí misma. Es para esto que el parámetro existe.
      await checkEmailAvailable(client, request.email, existing?.id);

      const accountId = existing
        ? await revive(client, existing, request)
        : await insertAccount(client, {
            personId: request.person_id,
            email: request.email,
            role: request.role,
            siteIds: request.site_ids,
          });

      // Sin credencial: puede entrar recién cuando la invitación se emita y se acepte. Vale
      // igual para la cuenta que nace y para la que vuelve — quitarle el acceso a alguien
      // revocó la suya.
      const account: CreateAccountResponse['account'] = {
        id: accountId,
        role: request.role,
        active: true,
        can_sign_in: false,
        email: request.email,
      };

      if (!request.invite) return { account };

      // MISMA transacción (design D4): el alta y la invitación son un solo COMMIT, así
      // que no existe el estado intermedio "cuenta creada, sin invitar".
      const invitation = await this.invitations.writeInvitation(client, actor.userId, accountId);

      return {
        account,
        invitation: { token: invitation.token, expiresAt: invitation.expiresAt },
      };
    });
  }

  /**
   * `GET /accounts/:id` (design D6) — una cuenta, con su email. El roster nunca lo
   * devuelve; esta es la única lectura que sí lo hace, y por eso está acotada a una
   * cuenta a la vez.
   *
   * Vía `withSessionClient` y no `asAdministrator`: es una lectura, no dispara el fanout
   * de auditoría, y el alcance que importa es el de la SESIÓN —`person` lleva RLS y filtra
   * sola— no el que `asAdministrator` reconstruye para una escritura.
   */
  async find(session: SessionScope, accountId: string): Promise<AccountDetail> {
    if (!isAdministrator(session.role)) throw accountForbidden();

    const row = await this.db.withSessionClient(session, (client) =>
      findAccountDetail(client, accountId),
    );

    if (!row) throw accountNotFound();

    return {
      id: row.id,
      role: row.role as AccountDetail['role'],
      active: row.active,
      can_sign_in: row.can_sign_in,
      email: row.email,
    };
  }

  /**
   * `PATCH /accounts/:id` — administrar el ACCESO y el rol de una cuenta existente.
   * Cuatro actos que comparten transacción y guardas: reemitir el link corrigiendo el correo
   * (design D5), quitar el acceso (`remove-jhsc-access-from-roster`), promover a coordinador y
   * devolver un coordinador a miembro del JHSC.
   *
   * **Por acá NO se devuelve el acceso.** Volver a darle acceso a alguien es invitarlo, y
   * eso es `POST /accounts`, que revive la cuenta que la persona ya tenía. Un
   * `deactivated: false` acá sería un segundo camino a la misma intención, y por eso el
   * contrato lo prohíbe en el tipo (`z.literal(true)`).
   *
   * **La guarda `can_sign_in` es de los dos primeros actos, no de la ruta.** Antes cerraba
   * la ruta entera, y ahí estaba bien: era la ruta de la reemisión, y reemitirle el link a
   * quien ya entra es la toma de control que el reinicio de contraseña se reserva. Pero
   * quitarle el acceso a quien SÍ puede entrar es justamente el caso principal de la baja
   * —sacar del JHSC a un miembro que trabaja todos los días—, así que la guarda bajó al
   * email y al `invite`, que son los que la necesitan.
   *
   * Un solo `COMMIT`, mismo criterio que `create()` con `invite: true` (design D4 de la
     * change archivada): ninguno de los dos actos deja un estado a medias si otro falla.
   */
  async update(
    actor: SessionScope & { role: Role },
    accountId: string,
    request: UpdateAccountRequest,
  ): Promise<CreateAccountResponse> {
    if (!isAdministrator(actor.role)) throw accountForbidden();
    if (request.promote_to !== undefined && actor.role !== 'management') {
      throw accountPromotionForbidden();
    }
    if (request.demote_to !== undefined && actor.role !== 'management') {
      throw accountDemotionForbidden();
    }

    const result = await asAdministrator(this.db, actor.userId, async (client) => {
      if (request.promote_to !== undefined) {
        return promote(client, actor.userId, actor.siteIds, accountId);
      }
      if (request.demote_to !== undefined) {
        return demote(client, actor.userId, actor.siteIds, accountId);
      }

      const existing = await findAccountDetail(client, accountId);
      if (!existing) throw accountNotFound();

      if (request.deactivated) return withdraw(client, existing);

      if (request.email !== undefined || request.invite) {
        if (existing.can_sign_in) throw accountAlreadyActive();
      }

      if (request.email && request.email !== existing.email) {
        await checkEmailAvailable(client, request.email, accountId);
        await client.query('UPDATE app_user SET email = $1 WHERE id = $2', [
          request.email,
          accountId,
        ]);
      }

      const account: CreateAccountResponse['account'] = {
        id: existing.id,
        role: existing.role as CreateAccountResponse['account']['role'],
        active: existing.active,
        can_sign_in: existing.can_sign_in,
        // El email que la cuenta tiene DESPUÉS de este PATCH: `existing` se leyó antes
        // del UPDATE de arriba, así que devolverlo tal cual reportaría el viejo.
        email: request.email ?? existing.email,
      };

      if (!request.invite) return { response: { account }, withdrawn: false };

      await revokePending(client, accountId);
      const invitation = await this.invitations.writeInvitation(client, actor.userId, accountId);

      return {
        response: {
          account,
          invitation: { token: invitation.token, expiresAt: invitation.expiresAt },
        },
        withdrawn: false,
      };
    });

    /**
     * DESPUÉS del COMMIT, y esta es la parte que no se puede acomodar "para que quede
     * más prolija" dentro de la transacción de arriba.
     *
     * `revokeAllForUser` empieza declarando el alcance de la CUENTA ADMINISTRADA
     * (`declareScopeFor`), y eso pisa `app.site_ids` y `app.user_id` de la transacción en
     * curso. Adentro de `asAdministrator` tendría dos efectos, los dos silenciosos: el
     * fanout de auditoría diferido a COMMIT compararía contra el alcance del objetivo en
     * vez del actor —y ahí muere la comprobación HS002 que `account-scope.ts` describe
     * como una regla de permisos gratis—, y la entrada quedaría firmada por la persona
     * removida, diciendo que se removió a sí misma.
     *
     * Que las sesiones caigan en una transacción posterior no abre ninguna ventana: el
     * guard de sesión rechaza la cuenta por `deactivated_at` en el request siguiente
     * (`session.service.ts`), que ya está commiteado. Esto es higiene del registro, y
     * el spec la exige ("A session ends when the account loses the right to hold it").
     */
    if (result.withdrawn) {
      await this.sessions.revokeAllForUser(accountId, 'account_deactivated');
    }

    return result.response;
  }
}

/**
 * Quitar el acceso: la misma escritura cancela una invitación que nadie aceptó y saca
 * del JHSC a un miembro que entra todos los días. Que sean el mismo acto no es un
 * ahorro — es que "esta cuenta ya no da acceso" es un solo hecho, y partirlo en dos
 * endpoints según si la persona llegó a poner su contraseña dejaría dos caminos que
 * hay que mantener iguales.
 *
 * **`user_site_scope` NO se toca, y es deliberado.** `hs_account_audit_fanout()` (0005
 * §8) escribe la entrada en la cadena de cada planta del alcance VIGENTE de la cuenta y
 * está diferida a COMMIT: revocar el alcance en esta misma transacción dejaría la baja
 * sin ninguna entrada de auditoría, que es el único rastro de que el acceso terminó. El
 * alcance intacto tampoco da acceso —`hs_account_is_active` lo mata por
 * `deactivated_at`—, y de yapa hace que restituir sea un solo UPDATE.
 */
async function withdraw(
  client: PoolClient,
  existing: { id: string; role: Role; active: boolean; email: string },
): Promise<{ response: CreateAccountResponse; withdrawn: boolean }> {
  if (existing.role !== 'jhsc_member') throw accountRoleNotRemovable();
  if (!existing.active) throw accountAlreadyInactive();

  await revokePending(client, existing.id);
  await revokeCredentials(client, existing.id);

  await client.query('UPDATE app_user SET deactivated_at = now() WHERE id = $1', [existing.id]);

  return {
    response: {
      account: {
        id: existing.id,
        role: existing.role as CreateAccountResponse['account']['role'],
        active: false,
        can_sign_in: false,
        email: existing.email,
      },
    },
    withdrawn: true,
  };
}

/**
 * Las mutaciones de rol expuestas. Corren dentro de `asAdministrator`, por lo que el
 * trigger existente firma el cambio y lo distribuye a cada cadena alcanzada por la
 * cuenta objetivo; el endpoint no escribe auditoría por su cuenta.
 */
async function promote(
  client: PoolClient,
  actorUserId: string,
  actorSiteIds: readonly string[],
  accountId: string,
): Promise<{ response: CreateAccountResponse; withdrawn: boolean }> {
  const existing = await roleChangeTarget(
    client,
    actorUserId,
    actorSiteIds,
    accountId,
    accountPromotionSelf,
  );
  if (existing.role !== 'jhsc_member') throw accountRoleNotPromotable(existing.role);
  if (!existing.active) throw accountPromotionInactive();

  await client.query("UPDATE app_user SET role = 'hs_coordinator' WHERE id = $1", [accountId]);

  return {
    response: {
      account: {
        id: existing.id,
        role: 'hs_coordinator',
        active: true,
        can_sign_in: existing.can_sign_in,
        email: existing.email,
      },
    },
    withdrawn: false,
  };
}

async function demote(
  client: PoolClient,
  actorUserId: string,
  actorSiteIds: readonly string[],
  accountId: string,
): Promise<{ response: CreateAccountResponse; withdrawn: boolean }> {
  const existing = await roleChangeTarget(
    client,
    actorUserId,
    actorSiteIds,
    accountId,
    accountDemotionSelf,
  );
  if (existing.role !== 'hs_coordinator') throw accountRoleNotDemotable(existing.role);
  if (!existing.active) throw accountDemotionInactive();

  await client.query("UPDATE app_user SET role = 'jhsc_member' WHERE id = $1", [accountId]);

  return {
    response: {
      account: {
        id: existing.id,
        role: 'jhsc_member',
        active: true,
        can_sign_in: existing.can_sign_in,
        email: existing.email,
      },
    },
    withdrawn: false,
  };
}

interface RoleChangeTarget {
  id: string;
  role: Role;
  active: boolean;
  can_sign_in: boolean;
  email: string;
  in_scope: boolean;
}

async function roleChangeTarget(
  client: PoolClient,
  actorUserId: string,
  actorSiteIds: readonly string[],
  accountId: string,
  selfError: () => AccountException,
): Promise<RoleChangeTarget> {
  const { rows } = await client.query<RoleChangeTarget>(
    `SELECT u.id, u.role, hs_account_is_active(u) AS active, u.email,
            EXISTS (
              SELECT 1 FROM app_credential c WHERE c.user_id = u.id AND c.revoked_at IS NULL
            ) AS can_sign_in,
            NOT EXISTS (
              SELECT 1
                FROM user_site_scope target_scope
               WHERE target_scope.user_id = u.id
                 AND target_scope.revoked_at IS NULL
                  AND NOT (target_scope.site_id = ANY($2::uuid[]))
              ) AS in_scope
       FROM app_user u
      WHERE u.id = $1
      FOR UPDATE OF u`,
    [accountId, actorSiteIds],
  );

  const existing = rows[0];
  if (!existing) throw accountNotFound();
  if (!existing.in_scope) throw accountOutOfScope();
  if (existing.id === actorUserId) throw selfError();

  return existing;
}

/**
 * Devolverle a una persona la cuenta que ya tenía. Es lo que hace `create()` cuando el alta
 * cae sobre alguien a quien se le quitó el acceso, y es invisible desde afuera: el llamador
 * pidió "dale acceso a esta persona" y eso es lo que pasa.
 *
 * `app_user.person_id` es UNIQUE, así que no hay una segunda cuenta que insertar ni la hubo
 * nunca. La que vuelve es LA MISMA fila, con su `id`, su historia de auditoría y su alcance
 * donde estaban — el motor escribe `user.reactivated` (y `user.email_changed` si el correo
 * cambió) en la cadena de cada planta que alcanza.
 *
   * **Solo revive con el MISMO rol.** Si la cuenta dada de baja era administrativa y el alta
   * pide `jhsc_member`, se responde el conflicto de siempre en vez de cambiarle el rol: eso es
 * una decisión con su propio evento de auditoría, y no puede salir de apretar "invitar" en
 * una lista de doscientas filas. La pantalla nunca produce ese caso —`canInvite` solo ofrece
 * el botón sobre una cuenta inactiva de `jhsc_member`—, así que la guarda protege a quien
 * llame la API a mano.
 *
 * No re-otorga el alcance que ya tiene vivo: la baja nunca lo revocó (ver `withdraw`). Sí
 * otorga el que falte, para que un alta que pide una planta nueva la agregue.
 */
async function revive(
  client: PoolClient,
  existing: { id: string; role: Role; active: boolean },
  request: CreateAccountRequest,
): Promise<string> {
  if (existing.active || existing.role !== request.role) throw accountAlreadyExists();

  await client.query('UPDATE app_user SET deactivated_at = NULL, email = $2 WHERE id = $1', [
    existing.id,
    request.email,
  ]);

  // `ON CONFLICT DO NOTHING` contra `user_site_scope_active_uq`, el índice único parcial
  // sobre las filas vigentes: lo normal es que no inserte nada.
  for (const siteId of request.site_ids) {
    await client.query(
      `INSERT INTO user_site_scope (user_id, site_id) VALUES ($1, $2)
       ON CONFLICT (user_id, site_id) WHERE revoked_at IS NULL DO NOTHING`,
      [existing.id, siteId],
    );
  }

  return existing.id;
}

interface PersonRow {
  id: string;
  deactivated_at: Date | null;
}

async function findPerson(client: PoolClient, personId: string): Promise<PersonRow | null> {
  const { rows } = await client.query<PersonRow>(
    `SELECT id, deactivated_at FROM person WHERE id = $1 FOR KEY SHARE`,
    [personId],
  );

  // Una persona dada de baja tampoco recibe cuenta: mismo criterio que
  // `create-account.mjs`. Se comparte el mensaje de "no existe" y no uno propio, por la
  // misma razón que `invitationInvalid()` unifica sus cuatro causas — distinguirlas acá
  // convertiría la ruta en un oráculo de quién está dado de baja.
  const row = rows[0];
  if (!row || row.deactivated_at) return null;

  return row;
}

/**
 * La cuenta de una persona, o `null`. A lo sumo una: `person_id` es UNIQUE. Devolverla en
 * vez de solo comprobar que no existe es lo que le permite a `create()` revivirla.
 */
async function findAccountOfPerson(
  client: PoolClient,
  personId: string,
): Promise<{ id: string; role: Role; active: boolean } | null> {
  const { rows } = await client.query<{ id: string; role: Role; active: boolean }>(
    `SELECT id, role, hs_account_is_active(app_user.*) AS active
       FROM app_user WHERE person_id = $1`,
    [personId],
  );

  return rows[0] ?? null;
}

/**
 * `excludeAccountId` es lo que distingue el alta de una cuenta nueva (no hay una fila propia
 * que excluir) de los dos actos que escriben sobre una que ya existe —revivirla en
 * `create()` y corregirle el correo en `update()`—: sin él, una cuenta que se queda con el
 * correo que ya tenía chocaría contra su propia fila.
 */
async function checkEmailAvailable(
  client: PoolClient,
  email: string,
  excludeAccountId?: string,
): Promise<void> {
  const { rows } = await client.query(
    'SELECT 1 FROM app_user WHERE email = $1 AND id IS DISTINCT FROM $2',
    [email, excludeAccountId ?? null],
  );

  if (rows.length > 0) throw accountEmailTaken();
}
