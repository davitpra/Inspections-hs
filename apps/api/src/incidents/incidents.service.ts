import { Injectable } from '@nestjs/common';
import {
  CURRENT_INCIDENT_FORM_VERSION,
  form7MappingOf,
  incidentTransitionFor,
  incidentRosterSchema,
  isAdministrator,
  requiresInvestigation,
  type Form7Mapping,
  type Incident,
  type IncidentRoster,
  type IncidentState,
  type IncidentTransitionRequest,
  type RecordCauseRequest,
  type ReportIncidentRequest,
} from '@hs/contracts';
import type { PoolClient } from 'pg';

import { DbService } from '../db/db.service';
import type { SessionScope } from '../db/site-scope';
import {
  firstPersonReport,
  incidentForbidden,
  incidentHasOpenActions,
  incidentNotFound,
  invalidLocation,
  invalidTransition,
  investigationNotOpen,
  investigationRequired,
  occurredAtInFuture,
  personNotActive,
  rootCauseRequired,
  translatePgError,
} from './incidents.errors';
import {
  currentState,
  findIncidentHeader,
  findInvestigation,
  insertCause,
  insertIncident,
  insertIncidentEvent,
  insertInvestigation,
  insertWitnesses,
  listIncidents,
  readIncident,
} from './incidents.repository';

/**
 * Si el rol de la sesión está entre los que la transición admite.
 *
 * La comparación se ensancha a `string` a propósito: `session.role` viene del guard como
 * texto y `transition.roles` es la lista tipada del contrato. Estrecharlo con un `as`
 * escondería que son dos fuentes distintas del mismo dato.
 */
function hasRole(roles: readonly string[] | undefined, role: string): boolean {
  if (roles === undefined) return false;

  return roles.includes(role) || (roles.includes('coordinator') && isAdministrator(role));
}

/**
 * Requisitos §7 etapa 6 — Lo que se puede hacer con un incidente desde HTTP.
 *
 * QUÉ NO APLICA ESTE SERVICIO, porque lo aplica el motor (migración 0012):
 *
 *   - Que la transición esté en la máquina de estados   → guarda `HS008`.
 *   - Que el stream no se bifurque bajo concurrencia    → único `(incident_id, position)`.
 *   - Que no queden acciones abiertas al cerrar         → guarda `HS009`.
 *   - Que tres clasificaciones exijan investigación     → guarda `HS010`.
 *   - Que cerrar exija causa raíz                       → guarda `HS011`.
 *   - Que un incidente tenga su evento de reporte       → restricción diferida `HS012`.
 *   - Que el evento no sea posterior al reporte         → CHECK de orden.
 *   - Que una planta no vea la otra                     → política RLS.
 *   - **Que un miembro del JHSC no vea incidentes administrativos** → política `RESTRICTIVE`. No hay
 *     `WHERE reported_by` en ninguna consulta de este módulo, y esa ausencia es el
 *     invariante (design D2).
 *
 * Lo que sí comprueba: los roles, que el sujeto y los testigos sean personas activas de
 * la planta, que la ubicación exista, y que el reportante no sea el sujeto. Las
 * comprobaciones que duplican una barrera del motor existen para devolver un código
 * legible; si el servicio se equivoca, el motor rechaza igual y `translatePgError`
 * traduce.
 */
@Injectable()
export class IncidentsService {
  constructor(private readonly db: DbService) {}

  /**
   * Reportar un incidente en tercera persona.
   *
   * El incidente, su primer evento, sus testigos y la notificación al coordinador se
   * escriben en la MISMA transacción, y no por prolijidad: la restricción diferida de
   * 0012 hace que un incidente sin evento no llegue a existir, y R4 pide que el
   * coordinador se entere — un aviso que se escribe después podría no escribirse.
   */
  async report(session: SessionScope, payload: ReportIncidentRequest): Promise<Incident> {
    // Reportar en tercera persona es un acto de los dos roles administrativos.
    const transition = incidentTransitionFor(null, 'reported');

    if (!hasRole(transition?.roles, session.role)) {
      throw incidentForbidden('Your role cannot report an incident');
    }

    const occurredAt = new Date(payload.occurred_at);
    const now = new Date();

    // El motor lo comprueba otra vez con el CHECK de orden. Acá se adelanta para no
    // depender de traducir un error de constraint en el camino normal.
    if (occurredAt.getTime() > now.getTime()) throw occurredAtInFuture();

    return this.db.withSessionClient(session, async (client) => {
      const siteId = await this.requireLocationSite(client, payload.location_id);

      await this.requireReportablePerson(client, payload.subject_person_id, siteId, 'The subject');

      // Reporte en tercera persona: el sujeto no puede ser quien reporta (§2, §3 R4).
      // Se compara contra la PERSONA de la cuenta, que es lo que hace la distinción
      // Persona ≠ Usuario significativa acá.
      const reporterPersonId = await this.personOf(client, session.userId);

      if (reporterPersonId !== null && reporterPersonId === payload.subject_person_id) {
        throw firstPersonReport();
      }

      for (const witnessId of payload.witness_person_ids) {
        await this.requireReportablePerson(client, witnessId, siteId, 'A witness');
      }

      const incidentId = await this.guarded(() =>
        insertIncident(client, {
          siteId,
          // La versión la pone el servidor: una fila que declara su propia versión
          // podría mentir sobre qué campos existían cuando se escribió.
          formVersion: CURRENT_INCIDENT_FORM_VERSION,
          classification: payload.classification,
          subjectPersonId: payload.subject_person_id,
          reportedBy: session.userId,
          occurredAt,
          // El reloj del SERVIDOR, porque de él cuelga el plazo del Form 7.
          reportedAt: now,
          locationId: payload.location_id,
          taskPerformed: payload.task_performed,
          equipmentInvolved: payload.equipment_involved,
          whatHappened: payload.what_happened,
          bodyPart: payload.body_part,
          onSiteTreatment: payload.on_site_treatment,
          immediateAction: payload.immediate_action,
          narrativeLanguage: payload.narrative_language,
        }),
      );

      await this.guarded(() =>
        insertWitnesses(client, incidentId, siteId, payload.witness_person_ids),
      );

      await this.guarded(() =>
        insertIncidentEvent(client, {
          incidentId,
          siteId,
          fromState: null,
          toState: 'reported',
          actorUserId: session.userId,
          note: null,
          reason: null,
          occurredAt: now,
        }),
      );

      await this.notifyCoordinators(client, incidentId);

      return this.readOne(client, incidentId, now);
    });
  }

  /**
   * Avanzar un incidente: un evento nuevo, nunca la corrección de una fila.
   *
   * El orden de las comprobaciones es el que produce el mejor error: primero que el
   * incidente exista dentro de lo que la sesión ve, después que la transición exista en
   * la máquina, después quién puede hacerla, y al final lo que esa transición exige.
   */
  async transition(
    session: SessionScope,
    incidentId: string,
    payload: IncidentTransitionRequest,
  ): Promise<Incident> {
    return this.db.withSessionClient(session, async (client) => {
      const header = await findIncidentHeader(client, incidentId);

      // El de otra planta, o uno no visible para un miembro del JHSC, no devuelve fila porque la
      // transacción no los ve — no porque este método los filtre. Por eso responden
      // igual que uno que no existe.
      if (!header) throw incidentNotFound();

      const current = await currentState(client, incidentId);
      const from: IncidentState | null = current?.state ?? null;

      const transition = incidentTransitionFor(from, payload.to);

      if (!transition) {
        throw invalidTransition(
          `An incident in state ${from ?? '(none)'} cannot move to ${payload.to}`,
        );
      }

      if (!hasRole(transition.roles, session.role)) {
        throw incidentForbidden('Your role cannot perform this transition on this incident');
      }

      if (transition.requires.includes('reason') && payload.reason === undefined) {
        throw invalidTransition('This transition requires a reason');
      }

      // La clasificación decide si el cierre directo existe siquiera para este
      // incidente. El motor lo comprueba otra vez con `HS010`.
      if (
        transition.requires.includes('investigation_optional') &&
        requiresInvestigation(header.classification)
      ) {
        throw investigationRequired();
      }

      if (transition.requires.includes('root_cause')) {
        if (!(await this.hasRootCause(client, incidentId))) throw rootCauseRequired();
      }

      if (transition.requires.includes('no_open_actions')) {
        if (await this.hasOpenActions(client, incidentId)) throw incidentHasOpenActions();
      }

      const now = new Date();

      // La investigación se abre en la MISMA transacción que la transición: la
      // restricción diferida de 0012 hace que un incidente en investigación sin su fila
      // de `investigation` no llegue a commitear.
      const method = payload.method;

      if (payload.to === 'under_investigation' && method !== undefined) {
        const existing = await findInvestigation(client, incidentId);

        if (!existing) {
          await this.guarded(() =>
            insertInvestigation(client, {
              incidentId,
              siteId: header.siteId,
              method,
              sequenceOfEvents: payload.sequence_of_events ?? null,
              openedBy: session.userId,
            }),
          );
        }
      }

      await this.guarded(() =>
        insertIncidentEvent(client, {
          incidentId,
          siteId: header.siteId,
          fromState: from,
          toState: payload.to,
          actorUserId: session.userId,
          note: payload.note ?? null,
          reason: payload.reason ?? null,
          occurredAt: now,
        }),
      );

      return this.readOne(client, incidentId, now);
    });
  }

  /**
   * Registrar una causa. Append-only: **corregir una causa es agregar otra**.
   *
   * No hay ruta para editarla ni para borrarla, y no es un olvido: 0012 no tiene un solo
   * `GRANT UPDATE` sobre `investigation_cause`.
   */
  async recordCause(
    session: SessionScope,
    incidentId: string,
    payload: RecordCauseRequest,
  ): Promise<Incident> {
    if (!isAdministrator(session.role)) {
      throw incidentForbidden('Only the coordinator records the causes of an investigation');
    }

    return this.db.withSessionClient(session, async (client) => {
      const header = await findIncidentHeader(client, incidentId);

      if (!header) throw incidentNotFound();

      const investigation = await findInvestigation(client, incidentId);

      if (!investigation) throw investigationNotOpen();

      await this.guarded(() =>
        insertCause(client, {
          investigationId: investigation.id,
          siteId: investigation.siteId,
          statement: payload.statement,
          isRoot: payload.is_root,
          parentCauseId: payload.parent_cause_id ?? null,
          recordedBy: session.userId,
        }),
      );

      return this.readOne(client, incidentId, new Date());
    });
  }

  async list(session: SessionScope): Promise<Incident[]> {
    const now = new Date();

    return this.db.withSessionClient(session, (client) => listIncidents(client, now));
  }

  /**
   * Las opciones activas para elegir sujeto o testigo, sin devolver el perfil de la persona.
   *
   * El rol se toma de la fila de reporte de la máquina de incidentes. El `WHERE site_id`
   * selecciona la planta pedida; la RLS de `person` decide si la sesión puede verla y hace
   * que una planta fuera del alcance responda con una lista vacía.
   */
  async roster(session: SessionScope, siteId: string): Promise<IncidentRoster> {
    if (!hasRole(incidentTransitionFor(null, 'reported')?.roles, session.role)) {
      throw incidentForbidden('Your role cannot list the incident roster');
    }

    return this.db.withSessionClient(session, async (client) => {
      const { rows } = await client.query<IncidentRoster[number]>(
        `SELECT id, employee_number, first_name, last_name
           FROM person
          WHERE site_id = $1
            AND deactivated_at IS NULL
          ORDER BY last_name, first_name`,
        [siteId],
      );

      return incidentRosterSchema.parse(rows);
    });
  }

  async get(session: SessionScope, incidentId: string): Promise<Incident> {
    const now = new Date();

    return this.db.withSessionClient(session, (client) =>
      this.readOne(client, incidentId, now),
    );
  }

  /**
   * La pantalla del Form 7: los valores del incidente y el mapeo de SU versión.
   *
   * **No genera nada** (riesgo H, cerrado en v1.2 a favor de la pantalla). No hay PDF,
   * no hay descarga y no hay envío: la responsabilidad legal es de una persona, que de
   * todas formas va a entrar al portal del WSIB.
   */
  async form7(
    session: SessionScope,
    incidentId: string,
  ): Promise<{ incident: Incident; mapping: Form7Mapping }> {
    const incident = await this.get(session, incidentId);

    return { incident, mapping: form7MappingOf(incident.form_version) };
  }

  // -------------------------------------------------------------------------

  /** La ubicación existe, está activa, y su planta es la del incidente. */
  private async requireLocationSite(client: PoolClient, locationId: string): Promise<string> {
    const { rows } = await client.query<{ site_id: string; deactivated_at: Date | null }>(
      `SELECT site_id, deactivated_at FROM location WHERE id = $1`,
      [locationId],
    );

    const row = rows[0];

    // Una ubicación de otra planta no devuelve fila —la RLS de `location` no la ve— y se
    // responde igual que una inexistente.
    if (!row || row.deactivated_at !== null) throw invalidLocation();

    return row.site_id;
  }

  /**
   * El sujeto y los testigos son PERSONAS activas de la planta del incidente.
   *
   * Se comprueba acá y no con una FK compuesta contra `person (site_id, id)` porque ese
   * único no existe a propósito: 0005 lo documenta —`person.site_id` es mutable y
   * congelar el par haría que transferir a alguien reescriba el pasado—. Igual que en
   * `actions.service.ts`.
   */
  private async requireReportablePerson(
    client: PoolClient,
    personId: string,
    siteId: string,
    what: string,
  ): Promise<void> {
    const { rows } = await client.query<{ site_id: string; deactivated_at: Date | null }>(
      `SELECT site_id, deactivated_at FROM person WHERE id = $1`,
      [personId],
    );

    const row = rows[0];

    if (!row) throw personNotActive(`${what} is not a person within your scope`);
    if (row.site_id !== siteId) throw personNotActive(`${what} works at another site`);
    if (row.deactivated_at !== null) throw personNotActive(`${what} is deactivated`);
  }

  private async personOf(client: PoolClient, userId: string): Promise<string | null> {
    const { rows } = await client.query<{ person_id: string | null }>(
      `SELECT person_id FROM app_user WHERE id = $1`,
      [userId],
    );

    return rows[0]?.person_id ?? null;
  }

  private async hasRootCause(client: PoolClient, incidentId: string): Promise<boolean> {
    const { rows } = await client.query<{ present: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM investigation i
           JOIN investigation_cause c ON c.investigation_id = i.id
          WHERE i.incident_id = $1 AND c.is_root) AS present`,
      [incidentId],
    );

    return rows[0]?.present === true;
  }

  /**
   * La misma función que evalúa el trigger, invocada desde el servicio.
   *
   * Se llama a `hs_incident_has_open_actions` en vez de repetir el `DISTINCT ON` acá:
   * dos implementaciones de la guarda de cierre podrían divergir, y esta es la única
   * regla del sistema cuya respuesta depende del estado de filas de otra tabla. El
   * trigger la evalúa igual dentro de la transacción del INSERT, que es lo que cierra
   * la carrera entre cerrar la última acción y cerrar el incidente (design D1).
   */
  private async hasOpenActions(client: PoolClient, incidentId: string): Promise<boolean> {
    const { rows } = await client.query<{ open: boolean }>(
      `SELECT hs_incident_has_open_actions($1) AS open`,
      [incidentId],
    );

    return rows[0]?.open === true;
  }

  /**
   * La bandeja del coordinador. §3 R4: "notifica al coordinador de HS".
   *
   * Una sola sentencia con subconsulta, igual que la asignación de una acción. El
   * payload lleva el id, la clasificación y los dos instantes — **nunca el nombre ni el
   * número de empleado del sujeto** (design D11): `notification` no tiene la política de
   * visibilidad del incidente, así que la identidad de la persona accidentada se
   * filtraría por una tabla adyacente.
   *
   * `dedupe_key` es el id del incidente: reportar es un hecho único, y el único de
   * `notification` hace que un reintento no duplique el aviso.
   */
  private async notifyCoordinators(client: PoolClient, incidentId: string): Promise<void> {
    await client.query(
      `INSERT INTO notification (user_id, site_id, kind, dedupe_key, payload)
       SELECT u.id, i.site_id, 'incident_reported', i.id::text,
              jsonb_build_object(
                'incident_id', i.id,
                'classification', i.classification,
                'occurred_at', i.occurred_at,
                'reported_at', i.reported_at)
         FROM incident i
         JOIN app_user u ON u.role = 'coordinator'
                        AND u.deactivated_at IS NULL
         JOIN user_site_scope s ON s.user_id = u.id
                               AND s.site_id = i.site_id
                               AND s.revoked_at IS NULL
        WHERE i.id = $1
       ON CONFLICT (user_id, kind, dedupe_key) DO NOTHING`,
      [incidentId],
    );
  }

  private async readOne(
    client: PoolClient,
    incidentId: string,
    now: Date,
  ): Promise<Incident> {
    const incident = await readIncident(client, incidentId, now);

    if (!incident) throw incidentNotFound();

    return incident;
  }

  /** Traduce los SQLSTATE de 0012; deja pasar cualquier otro error tal como vino. */
  private async guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      throw translatePgError(error) ?? error;
    }
  }
}
