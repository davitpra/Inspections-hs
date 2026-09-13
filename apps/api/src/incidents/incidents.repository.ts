import type { PoolClient } from 'pg';
import {
  fieldsOfVersion,
  isClockOverdue,
  regulatoryClocks,
  type BodyPart,
  type Incident,
  type IncidentClassification,
  type IncidentEvent,
  type IncidentState,
  type Investigation,
  type InvestigationCause,
  type InvestigationMethod,
  type NarrativeLanguage,
  type OnSiteTreatment,
  type RegulatoryClockDto,
} from '@hs/contracts';

/**
 * Las consultas del módulo de incidentes. Requisitos §7 etapa 6.
 *
 * **Ninguna lleva `WHERE site_id` NI `WHERE reported_by`, y esas dos ausencias son el
 * invariante.** El recorte por planta lo hace `hs_apply_site_isolation` y el recorte por
 * visibilidad lo hace la política `RESTRICTIVE` de 0012 (design D2). Un inspector no ve
 * incidentes administrativos porque la política no se los devuelve, no porque este
 * archivo se acuerde de filtrar — y por eso un `SELECT *` crudo dentro de su transacción
 * tampoco se lo devuelve.
 */

/** El estado vigente de un incidente, o `null` si no existe en este alcance. */
export async function currentState(
  client: PoolClient,
  incidentId: string,
): Promise<{ state: IncidentState; position: number } | null> {
  // La consulta que ADR-002 escribió, para un solo incidente. Se apoya en el índice del
  // único `(incident_id, position)`, leído hacia atrás.
  const { rows } = await client.query<{ to_state: IncidentState; position: number }>(
    `SELECT e.to_state, e.position
       FROM incident_event e
      WHERE e.incident_id = $1
      ORDER BY e.position DESC
      LIMIT 1`,
    [incidentId],
  );

  const row = rows[0];

  return row ? { state: row.to_state, position: row.position } : null;
}

export interface IncidentHeader {
  siteId: string;
  classification: IncidentClassification;
  reportedBy: string;
}

/** Lo mínimo para decidir una transición, sin traer el incidente entero. */
export async function findIncidentHeader(
  client: PoolClient,
  incidentId: string,
): Promise<IncidentHeader | null> {
  const { rows } = await client.query<{
    site_id: string;
    classification: IncidentClassification;
    reported_by: string;
  }>(`SELECT site_id, classification, reported_by FROM incident WHERE id = $1`, [incidentId]);

  const row = rows[0];

  return row
    ? { siteId: row.site_id, classification: row.classification, reportedBy: row.reported_by }
    : null;
}

export interface InsertIncidentInput {
  siteId: string;
  formVersion: number;
  classification: IncidentClassification;
  subjectPersonId: string;
  reportedBy: string;
  occurredAt: Date;
  reportedAt: Date;
  locationId: string;
  taskPerformed: string;
  equipmentInvolved: string;
  whatHappened: string;
  bodyPart: BodyPart;
  onSiteTreatment: OnSiteTreatment;
  immediateAction: string;
  narrativeLanguage: NarrativeLanguage;
}

export async function insertIncident(
  client: PoolClient,
  input: InsertIncidentInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO incident
       (site_id, form_version, classification, subject_person_id, reported_by,
        occurred_at, reported_at, location_id, task_performed, equipment_involved,
        what_happened, body_part, on_site_treatment, immediate_action, narrative_language)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING id`,
    [
      input.siteId,
      input.formVersion,
      input.classification,
      input.subjectPersonId,
      input.reportedBy,
      input.occurredAt,
      input.reportedAt,
      input.locationId,
      input.taskPerformed,
      input.equipmentInvolved,
      input.whatHappened,
      input.bodyPart,
      input.onSiteTreatment,
      input.immediateAction,
      input.narrativeLanguage,
    ],
  );

  const id = rows[0]?.id;

  if (!id) throw new Error('incident insert returned no id');

  return id;
}

export interface InsertIncidentEventInput {
  incidentId: string;
  siteId: string;
  fromState: IncidentState | null;
  toState: IncidentState;
  actorUserId: string;
  note: string | null;
  reason: string | null;
  occurredAt: Date;
}

/**
 * La `position` se calcula en la misma sentencia que el INSERT.
 *
 * Leerla antes con un `SELECT` y mandarla como parámetro dejaría una ventana entre las
 * dos sentencias; adentro del INSERT la ventana sigue existiendo —Postgres no serializa
 * dos INSERT concurrentes por sí solo— pero la cierra el único `(incident_id, position)`,
 * que es la barrera de concurrencia. Igual que en 0011.
 */
export async function insertIncidentEvent(
  client: PoolClient,
  input: InsertIncidentEventInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO incident_event
       (incident_id, site_id, position, from_state, to_state, actor_user_id, note, reason,
        occurred_at)
     SELECT $1, $2,
            COALESCE((SELECT max(e.position) + 1 FROM incident_event e
                       WHERE e.incident_id = $1), 0),
            $3, $4, $5, $6, $7, $8
     RETURNING id`,
    [
      input.incidentId,
      input.siteId,
      input.fromState,
      input.toState,
      input.actorUserId,
      input.note,
      input.reason,
      input.occurredAt,
    ],
  );

  const id = rows[0]?.id;

  if (!id) throw new Error('incident_event insert returned no id');

  return id;
}

export async function insertWitnesses(
  client: PoolClient,
  incidentId: string,
  siteId: string,
  personIds: readonly string[],
): Promise<void> {
  if (personIds.length === 0) return;

  await client.query(
    `INSERT INTO incident_witness (incident_id, site_id, person_id)
     SELECT $1, $2, unnest($3::uuid[])`,
    [incidentId, siteId, personIds],
  );
}

export async function insertInvestigation(
  client: PoolClient,
  input: {
    incidentId: string;
    siteId: string;
    method: InvestigationMethod;
    sequenceOfEvents: string | null;
    openedBy: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO investigation (incident_id, site_id, method, sequence_of_events, opened_by)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      input.incidentId,
      input.siteId,
      input.method,
      input.sequenceOfEvents,
      input.openedBy,
    ],
  );

  const id = rows[0]?.id;

  if (!id) throw new Error('investigation insert returned no id');

  return id;
}

export async function findInvestigation(
  client: PoolClient,
  incidentId: string,
): Promise<{ id: string; siteId: string } | null> {
  const { rows } = await client.query<{ id: string; site_id: string }>(
    `SELECT id, site_id FROM investigation WHERE incident_id = $1`,
    [incidentId],
  );

  const row = rows[0];

  return row ? { id: row.id, siteId: row.site_id } : null;
}

/** Igual que el evento: la posición se calcula adentro y el único resuelve la carrera. */
export async function insertCause(
  client: PoolClient,
  input: {
    investigationId: string;
    siteId: string;
    statement: string;
    isRoot: boolean;
    parentCauseId: string | null;
    recordedBy: string;
  },
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO investigation_cause
       (investigation_id, site_id, position, statement, is_root, parent_cause_id, recorded_by)
     SELECT $1, $2,
            COALESCE((SELECT max(c.position) + 1 FROM investigation_cause c
                       WHERE c.investigation_id = $1), 1),
            $3, $4, $5, $6
     RETURNING id`,
    [
      input.investigationId,
      input.siteId,
      input.statement,
      input.isRoot,
      input.parentCauseId,
      input.recordedBy,
    ],
  );

  const id = rows[0]?.id;

  if (!id) throw new Error('investigation_cause insert returned no id');

  return id;
}

// ---------------------------------------------------------------------------
// La lectura

const INCIDENT_SELECT = `
  SELECT i.id, i.site_id, i.form_version, i.classification, i.subject_person_id,
         i.reported_by, i.occurred_at, i.reported_at, i.location_id, i.task_performed,
         i.equipment_involved, i.what_happened, i.body_part, i.on_site_treatment,
         i.immediate_action, i.narrative_language, i.created_at,
         s.to_state AS state,
         COALESCE(w.witnesses, '[]'::jsonb) AS witnesses,
         COALESCE(ev.events, '[]'::jsonb) AS events,
         v.investigation AS investigation
    FROM incident i
    LEFT JOIN LATERAL (
      SELECT e.to_state FROM incident_event e
       WHERE e.incident_id = i.id
       ORDER BY e.position DESC
       LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      -- El testigo viaja como un PersonOption y nada más: número de empleado y nombre.
      -- §4 dice que el selector no muestra perfiles, y devolver acá el sitio o el
      -- estado de la persona sería la misma filtración por la puerta de la lectura.
      SELECT jsonb_agg(jsonb_build_object(
               'id', p.id,
               'employee_number', p.employee_number,
               'first_name', p.first_name,
               'last_name', p.last_name)
             ORDER BY p.employee_number) AS witnesses
        FROM incident_witness iw
        JOIN person p ON p.id = iw.person_id
       WHERE iw.incident_id = i.id
    ) w ON true
    LEFT JOIN LATERAL (
      -- Ordenado por la posición NUMÉRICA, por lo mismo que en 0011: ordenar por el
      -- texto del jsonb pondría la transición 10 antes de la 2.
      SELECT jsonb_agg(rows.row ORDER BY rows.pos) AS events
        FROM (
          SELECT e.position AS pos, jsonb_build_object(
                   'id', e.id,
                   'position', e.position,
                   'from_state', e.from_state,
                   'to_state', e.to_state,
                   'actor_user_id', e.actor_user_id,
                   'note', e.note,
                   'reason', e.reason,
                   'occurred_at', e.occurred_at,
                   'recorded_at', e.recorded_at) AS row
            FROM incident_event e
           WHERE e.incident_id = i.id
        ) rows
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
               'id', n.id,
               'incident_id', n.incident_id,
               'site_id', n.site_id,
               'method', n.method,
               'sequence_of_events', n.sequence_of_events,
               'opened_by', n.opened_by,
               'opened_at', n.opened_at,
               'causes', COALESCE(
                 (SELECT jsonb_agg(jsonb_build_object(
                            'id', c.id,
                            'position', c.position,
                            'statement', c.statement,
                            'is_root', c.is_root,
                            'parent_cause_id', c.parent_cause_id,
                            'recorded_by', c.recorded_by,
                            'recorded_at', c.recorded_at)
                          ORDER BY c.position)
                    FROM investigation_cause c WHERE c.investigation_id = n.id),
                 '[]'::jsonb)) AS investigation
        FROM investigation n WHERE n.incident_id = i.id
    ) v ON true`;

export async function listIncidents(client: PoolClient, now: Date): Promise<Incident[]> {
  const { rows } = await client.query<IncidentRow>(
    `${INCIDENT_SELECT} ORDER BY i.reported_at DESC`,
  );

  return rows.map((row) => toIncident(row, now));
}

export async function readIncident(
  client: PoolClient,
  incidentId: string,
  now: Date,
): Promise<Incident | null> {
  const { rows } = await client.query<IncidentRow>(`${INCIDENT_SELECT} WHERE i.id = $1`, [
    incidentId,
  ]);
  const row = rows[0];

  return row ? toIncident(row, now) : null;
}

interface RawEvent {
  id: string;
  position: number;
  from_state: IncidentState | null;
  to_state: IncidentState;
  actor_user_id: string;
  note: string | null;
  reason: string | null;
  occurred_at: string;
  recorded_at: string;
}

interface RawCause {
  id: string;
  position: number;
  statement: string;
  is_root: boolean;
  parent_cause_id: string | null;
  recorded_by: string;
  recorded_at: string;
}

interface RawInvestigation {
  id: string;
  incident_id: string;
  site_id: string;
  method: InvestigationMethod;
  sequence_of_events: string | null;
  opened_by: string;
  opened_at: string;
  causes: RawCause[];
}

interface IncidentRow {
  id: string;
  site_id: string;
  form_version: number;
  classification: IncidentClassification;
  subject_person_id: string;
  reported_by: string;
  occurred_at: Date;
  reported_at: Date;
  location_id: string;
  task_performed: string;
  equipment_involved: string;
  what_happened: string;
  body_part: BodyPart;
  on_site_treatment: OnSiteTreatment;
  immediate_action: string;
  narrative_language: NarrativeLanguage;
  created_at: Date;
  state: IncidentState;
  witnesses: { id: string; employee_number: string; first_name: string; last_name: string }[];
  events: RawEvent[];
  investigation: RawInvestigation | null;
}

/**
 * De la fila a lo que la API devuelve.
 *
 * **Los relojes se calculan acá y no salen de ninguna columna** (ADR-008, design D7).
 * Sus tres entradas están congeladas en la fila, así que dos lecturas separadas por un
 * mes dan lo mismo; `now` entra por parámetro y no se lee adentro, para que `overdue`
 * sea reproducible en un test sin mover el reloj del proceso.
 */
function toIncident(row: IncidentRow, now: Date): Incident {
  const clocks = regulatoryClocks({
    classification: row.classification,
    occurredAt: row.occurred_at,
    reportedAt: row.reported_at,
  });

  return {
    id: row.id,
    site_id: row.site_id,
    form_version: row.form_version,
    classification: row.classification,
    subject_person_id: row.subject_person_id,
    reported_by: row.reported_by,
    occurred_at: row.occurred_at.toISOString(),
    reported_at: row.reported_at.toISOString(),
    location_id: row.location_id,
    task_performed: row.task_performed,
    equipment_involved: row.equipment_involved,
    what_happened: row.what_happened,
    body_part: row.body_part,
    on_site_treatment: row.on_site_treatment,
    immediate_action: row.immediate_action,
    narrative_language: row.narrative_language,
    created_at: row.created_at.toISOString(),
    // Derivado del último evento. La restricción diferida de 0012 garantiza que hay uno.
    state: row.state,
    clocks: clocks.map((clock): RegulatoryClockDto => ({
      authority: clock.authority,
      obligation: clock.obligation,
      counts_from: clock.countsFrom,
      from: clock.from.toISOString(),
      due_at: clock.dueAt?.toISOString() ?? null,
      immediate: clock.immediate,
      overdue: isClockOverdue(clock, now),
      citation: clock.citation,
    })),
    // Qué campos tenía la versión de ESTE incidente, no la de hoy (pregunta cerrada 10).
    fields_of_version: [...fieldsOfVersion(row.form_version)],
    witnesses: row.witnesses.map((witness) => ({
      id: witness.id,
      employee_number: witness.employee_number,
      first_name: witness.first_name,
      last_name: witness.last_name,
    })),
    events: row.events.map(toEvent),
    investigation: row.investigation ? toInvestigation(row.investigation) : null,
  };
}

function toEvent(raw: RawEvent): IncidentEvent {
  return {
    id: raw.id,
    position: raw.position,
    from_state: raw.from_state,
    to_state: raw.to_state,
    actor_user_id: raw.actor_user_id,
    note: raw.note,
    reason: raw.reason,
    occurred_at: new Date(raw.occurred_at).toISOString(),
    recorded_at: new Date(raw.recorded_at).toISOString(),
  };
}

function toInvestigation(raw: RawInvestigation): Investigation {
  return {
    id: raw.id,
    incident_id: raw.incident_id,
    site_id: raw.site_id,
    method: raw.method,
    sequence_of_events: raw.sequence_of_events,
    opened_by: raw.opened_by,
    opened_at: new Date(raw.opened_at).toISOString(),
    causes: raw.causes.map(
      (cause): InvestigationCause => ({
        id: cause.id,
        position: cause.position,
        statement: cause.statement,
        is_root: cause.is_root,
        parent_cause_id: cause.parent_cause_id,
        recorded_by: cause.recorded_by,
        recorded_at: new Date(cause.recorded_at).toISOString(),
      }),
    ),
  };
}
