import { Injectable } from '@nestjs/common';
import {
  ASSIGNEE,
  transitionFor,
  type Action,
  type ActionState,
  type ActionSummary,
  type CreateActionRequest,
  type TransitionRequest,
} from '@hs/contracts';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import {
  actionForbidden,
  actionNotFound,
  evidenceRequired,
  invalidAssignee,
  invalidDueAt,
  invalidEvidence,
  invalidTransition,
  translatePgError,
  verifierIsExecutor,
} from './actions.errors';
import {
  currentState,
  findActionHeader,
  insertAction,
  insertEvent,
  insertEvidence,
  lastExecutor,
  listActions,
  readAction,
} from './actions.repository';
import { foreignEvidenceKeys } from './object-key';

/**
 * Requisitos §7 etapa 5 — Lo que se puede hacer con una acción correctiva desde HTTP.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor (migración 0011):
 *
 *   - Que la transición esté en la máquina de estados   → guarda `HS004`.
 *   - Que el stream no se bifurque bajo concurrencia    → único `(action_id, position)`.
 *   - Que quien verifica no sea quien ejecutó           → guarda `HS005`.
 *   - Que declarar el trabajo hecho lleve evidencia     → restricción diferida `HS006`.
 *   - Que una acción tenga al menos un evento           → restricción diferida `HS007`.
 *   - Que rechazar una verificación lleve motivo        → CHECK de motivo.
 *   - Que la acción sea del sitio de su hallazgo        → FK compuesta.
 *   - Que una planta no vea la otra                     → política RLS. No hay `WHERE
 *     site_id` en ninguna consulta de este módulo.
 *
 * Lo que sí comprueba: los roles y la relación "esta acción es mía" —que el motor no
 * conoce—, que el padre exista dentro del alcance, que el plazo sea futuro, que el
 * responsable sea una persona activa de la planta, y las object keys de la evidencia.
 * La garantía de que el plazo sea futuro NO la duplica el motor: depende del reloj y por
 * eso vive solamente acá. Las comprobaciones que duplican una
 * barrera del motor existen para devolver un código legible; si el servicio se
 * equivoca, el motor rechaza igual y `translatePgError` traduce.
 */
@Injectable()
export class ActionsService {
  constructor(private readonly db: DbService) {}

  /**
   * Abrir una acción sobre un hallazgo.
   *
   * La acción y su primer evento se escriben en la MISMA transacción, y no por prolijidad:
   * la restricción diferida de 0011 hace que una acción sin evento no llegue a existir,
   * porque su estado se deriva del stream y una acción sin stream no tendría ninguno.
   */
  async create(
    session: SessionScope,
    findingId: string,
    payload: CreateActionRequest,
  ): Promise<Action> {
    if (session.role !== 'hs_coordinator') {
      throw actionForbidden('Only the HS coordinator opens a corrective action');
    }

    return this.db.withSessionClient(session, async (client) => {
      const siteId = await this.requireFindingSite(client, findingId);

      return this.createForParent(client, session, payload, {
        siteId,
        findingId,
        investigationId: null,
      });
    });
  }

  /**
   * Avanzar una acción: un evento nuevo, nunca la corrección de una fila.
   *
   * El orden de las comprobaciones es el que produce el mejor error: primero que la
   * acción exista dentro del alcance, después que la transición exista en la máquina,
   * después quién puede hacerla, y al final los datos que esa transición exige.
   */
  async transition(
    session: SessionScope,
    actionId: string,
    payload: TransitionRequest,
  ): Promise<Action> {
    return this.db.withSessionClient(session, async (client) => {
      const header = await findActionHeader(client, actionId);

      // La de otra planta no devuelve fila porque la transacción no la ve, no porque
      // este método la filtre. Por eso responde igual que una que no existe.
      if (!header) throw actionNotFound();

      const current = await currentState(client, actionId);
      const from: ActionState | null = current?.state ?? null;

      const transition = transitionFor(from, payload.to);

      if (!transition) {
        throw invalidTransition(
          `An action in state ${from ?? '(none)'} cannot move to ${payload.to}`,
        );
      }

      await this.requireActor(client, session, header.assigneePersonId, transition.roles);

      if (transition.requires.includes('reason') && payload.reason === undefined) {
        throw invalidTransition('Refusing a verification requires a reason');
      }

      if (transition.requires.includes('after_evidence')) {
        if (!payload.evidence.some((item) => item.kind === 'after')) {
          throw evidenceRequired();
        }
      }

      if (transition.requires.includes('not_executor')) {
        const executor = await lastExecutor(client, actionId);

        // El motor lo comprueba otra vez con `HS005`. Acá se adelanta para no depender
        // de traducir un error de trigger en el camino normal.
        if (executor === session.userId) {
          throw verifierIsExecutor();
        }
      }

      const foreign = foreignEvidenceKeys(
        payload.evidence.map((item) => item.object_key),
        header.siteId,
        actionId,
      );

      if (foreign.length > 0) {
        throw invalidEvidence('The evidence references files that do not belong to this action');
      }

      const now = new Date();

      const eventId = await this.guarded(() =>
        insertEvent(client, {
          actionId,
          siteId: header.siteId,
          fromState: from,
          toState: payload.to,
          actorUserId: session.userId,
          note: payload.note ?? null,
          reason: payload.reason ?? null,
          occurredAt: now,
        }),
      );

      await this.guarded(() =>
        insertEvidence(client, eventId, actionId, header.siteId, payload.evidence),
      );

      return this.readOne(client, actionId);
    });
  }

  /**
   * Abrir una acción sobre una investigación (§4, etapa 6).
   *
   * **El mismo motor, la misma fecha declarada, la misma evidencia, el mismo verificador
   * y el mismo escalamiento.** Solo cambia el padre de la acción.
   *
   * Que el resto del ciclo de vida no distinga el padre no es una coincidencia: es lo
   * que hace que "el incidente usa el mismo motor que la acción correctiva" (§4) sea
   * cierto en el código y no solo en el documento.
   */
  async createForInvestigation(
    session: SessionScope,
    investigationId: string,
    payload: CreateActionRequest,
  ): Promise<Action> {
    if (session.role !== 'hs_coordinator') {
      throw actionForbidden('Only the HS coordinator opens a corrective action');
    }

    return this.db.withSessionClient(session, async (client) => {
      const siteId = await this.requireInvestigationSite(client, investigationId);

      return this.createForParent(client, session, payload, {
        siteId,
        findingId: null,
        investigationId,
      });
    });
  }

  async list(session: SessionScope): Promise<ActionSummary[]> {
    return this.db.withSessionClient(session, (client) => listActions(client));
  }

  async get(session: SessionScope, actionId: string): Promise<Action> {
    return this.db.withSessionClient(session, (client) => this.readOne(client, actionId));
  }

  // -------------------------------------------------------------------------

  private async requireFindingSite(
    client: PoolClient,
    findingId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ site_id: string }>(
      `SELECT site_id FROM finding WHERE id = $1`,
      [findingId],
    );

    const row = rows[0];

    // Un hallazgo de la otra planta se ve igual que uno inexistente, y los dos se
    // responden como "no existe esta acción... para este hallazgo": el 404 es del
    // hallazgo, no de la acción.
    if (!row) throw actionNotFound();

    return row.site_id;
  }

  private async createForParent(
    client: PoolClient,
    session: SessionScope,
    payload: CreateActionRequest,
    parent: { siteId: string; findingId: string | null; investigationId: string | null },
  ): Promise<Action> {
    const now = new Date();
    const dueAt = new Date(payload.due_at);

    if (dueAt <= now) throw invalidDueAt();

    await this.requireAssignablePerson(client, payload.assignee_person_id, parent.siteId);

    const actionId = await this.guarded(() =>
      insertAction(client, {
        siteId: parent.siteId,
        findingId: parent.findingId,
        investigationId: parent.investigationId,
        assigneePersonId: payload.assignee_person_id,
        description: payload.description,
        dueAt,
        remediationGroupId: payload.remediation_group_id ?? null,
        createdBy: session.userId,
      }),
    );

    await this.guarded(() =>
      insertEvent(client, {
        actionId,
        siteId: parent.siteId,
        fromState: null,
        toState: 'open',
        actorUserId: session.userId,
        note: null,
        reason: null,
        occurredAt: now,
      }),
    );

    await this.notifyAssignee(client, actionId);

    return this.readOne(client, actionId);
  }

  /**
   * La investigación existe dentro de lo que la sesión ve, y su planta es la de la
   * acción.
   *
   * La política `RESTRICTIVE` de 0012 se aplica acá también: si el coordinador no
   * pudiera ver el incidente, esta consulta no devolvería fila y la acción no se crearía.
   * No hay `WHERE site_id` ni `WHERE reported_by`.
   */
  private async requireInvestigationSite(
    client: PoolClient,
    investigationId: string,
  ): Promise<string> {
    const { rows } = await client.query<{ site_id: string }>(
      `SELECT site_id FROM investigation WHERE id = $1`,
      [investigationId],
    );

    const row = rows[0];

    // Una investigación que no se ve y una que no existe se responden igual.
    if (!row) throw actionNotFound();

    return row.site_id;
  }

  /**
   * El responsable es una PERSONA activa de la planta de la acción.
   *
   * Se comprueba acá y no con una FK compuesta contra `person (site_id, id)` porque ese
   * único no existe a propósito: 0005 lo documenta —`person.site_id` es mutable y
   * congelar el par haría que transferir a alguien reescriba el pasado—. Que la persona
   * exista dentro del alcance ya lo garantiza la política RLS de `person`; lo que se
   * agrega acá es que sea de ESTA planta y que no esté dada de baja.
   */
  private async requireAssignablePerson(
    client: PoolClient,
    personId: string,
    siteId: string,
  ): Promise<void> {
    const { rows } = await client.query<{ site_id: string; deactivated_at: Date | null }>(
      `SELECT site_id, deactivated_at FROM person WHERE id = $1`,
      [personId],
    );

    const row = rows[0];

    if (!row) throw invalidAssignee('No such person within your scope');
    if (row.site_id !== siteId) throw invalidAssignee('That person works at another site');
    if (row.deactivated_at !== null) throw invalidAssignee('That person is deactivated');
  }

  /**
   * Quién puede hacer esta transición.
   *
   * `assignee` no es un rol: es la cuenta de la persona responsable de ESTA acción, y
   * por eso se resuelve contra `app_user.person_id` y no contra `app_user.role`. Una
   * persona sin cuenta no puede actuar por sí misma — el coordinador lo hace en su
   * nombre, y el evento nombra al coordinador (design D12).
   */
  private async requireActor(
    client: PoolClient,
    session: SessionScope,
    assigneePersonId: string,
    roles: readonly string[],
  ): Promise<void> {
    if (roles.includes(session.role)) return;

    if (roles.includes(ASSIGNEE)) {
      const { rows } = await client.query<{ person_id: string }>(
        `SELECT person_id FROM app_user WHERE id = $1`,
        [session.userId],
      );

      if (rows[0]?.person_id === assigneePersonId) return;
    }

    throw actionForbidden('Your role cannot perform this transition on this action');
  }

  /**
   * La bandeja del responsable, si tiene cuenta.
   *
   * Una sola sentencia con subconsulta, igual que la notificación de apertura de
   * período: sin cuenta activa no hay fila, y la acción se crea igual. Es la
   * consecuencia directa de Persona ≠ Usuario, y la red que la cubre es el escalamiento
   * a los +3 días, que llega al supervisor.
   *
   * `dedupe_key` es el id de la acción: crear una acción es un hecho único, pero el
   * único de `notification` es lo que hace que un reintento no duplique el aviso.
   */
  private async notifyAssignee(client: PoolClient, actionId: string): Promise<void> {
    await client.query(
      `INSERT INTO notification (user_id, site_id, kind, dedupe_key, payload)
       SELECT u.id, a.site_id, 'corrective_action_assigned', a.id::text,
              jsonb_build_object(
                'action_id', a.id,
                'finding_id', a.finding_id,
                'description', a.description,
                 'due_at', a.due_at)
         FROM corrective_action a
         JOIN app_user u ON u.person_id = a.assignee_person_id
                        AND u.deactivated_at IS NULL
         JOIN user_site_scope s ON s.user_id = u.id
                               AND s.site_id = a.site_id
                               AND s.revoked_at IS NULL
        WHERE a.id = $1
       ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING`,
      [actionId],
    );
  }

  private async readOne(client: PoolClient, actionId: string): Promise<Action> {
    const action = await readAction(client, actionId);

    if (!action) throw actionNotFound();

    return action;
  }

  /** Traduce los SQLSTATE de 0011; deja pasar cualquier otro error tal como vino. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw translatePgError(error) ?? error;
    }
  }
}
