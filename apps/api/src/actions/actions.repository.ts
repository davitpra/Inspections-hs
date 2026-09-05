import type { PoolClient } from 'pg';
import type {
  Action,
  ActionEvent,
  ActionState,
  ActionSummary,
  EscalationLevel,
  EvidenceInput,
} from '@hs/contracts';

/**
 * Las consultas del módulo de acciones. Requisitos §7 etapa 5.
 *
 * **Ninguna lleva `WHERE site_id`, y esa ausencia es el invariante**: el recorte por
 * planta lo hace la política RLS sobre la transacción (ADR-002). Un supervisor de St.
 * Thomas no ve Glencoe porque la política no se lo devuelve, no porque este archivo se
 * acuerde de filtrar.
 *
 * Un repositorio y no consultas dentro del servicio —que es lo que hace `findings`—
 * porque acá hay dos consumidores del mismo SQL: el camino HTTP y el cron de
 * escalamiento. El día que fueran uno solo, esto sería una capa de más.
 */

/** El estado vigente de una acción, o `null` si la acción no existe en este alcance. */
export async function currentState(
  client: PoolClient,
  actionId: string,
): Promise<{ state: ActionState; position: number } | null> {
  // La consulta que ADR-002 escribió, para una sola acción. Se apoya en el índice del
  // único `(action_id, position)`, leído hacia atrás.
  const { rows } = await client.query<{ to_state: ActionState; position: number }>(
    `SELECT e.to_state, e.position
       FROM corrective_action_event e
      WHERE e.action_id = $1
      ORDER BY e.position DESC
      LIMIT 1`,
    [actionId],
  );

  const row = rows[0];

  return row ? { state: row.to_state, position: row.position } : null;
}

export interface InsertActionInput {
  siteId: string;
  /** Exactamente uno de los dos; el `CHECK` de 0012 rechaza ninguno y rechaza los dos. */
  findingId: string | null;
  investigationId: string | null;
  assigneePersonId: string;
  description: string;
  dueAt: Date;
  remediationGroupId: string | null;
  createdBy: string;
}

export async function insertAction(
  client: PoolClient,
  input: InsertActionInput,
): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO corrective_action
       (site_id, finding_id, investigation_id, assignee_person_id, description,
        due_at, remediation_group_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.siteId,
      input.findingId,
      input.investigationId,
      input.assigneePersonId,
      input.description,
      input.dueAt,
      input.remediationGroupId,
      input.createdBy,
    ],
  );

  const id = rows[0]?.id;

  if (!id) throw new Error('corrective_action insert returned no id');

  return id;
}

export interface InsertEventInput {
  actionId: string;
  siteId: string;
  fromState: ActionState | null;
  toState: ActionState;
  actorUserId: string;
  note: string | null;
  reason: string | null;
  occurredAt: Date;
}

/**
 * Agrega un evento al stream.
 *
 * `position` se calcula en la misma sentencia como "la última de esta acción + 1", en
 * vez de leerla antes y sumarle uno en TypeScript: entre la lectura y la escritura
 * cabe otra transición. Aun así **la carrera no se cierra acá** —dos transacciones
 * concurrentes leen la misma última posición— sino en el único
 * `corrective_action_event_position_uq`, que hace que la segunda falle en vez de
 * bifurcar el stream. Esta subconsulta solo evita el viaje de más.
 */
export async function insertEvent(client: PoolClient, input: InsertEventInput): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO corrective_action_event
       (action_id, site_id, position, from_state, to_state, actor_user_id, note, reason, occurred_at)
     SELECT $1, $2,
            coalesce((SELECT max(e.position) + 1 FROM corrective_action_event e
                       WHERE e.action_id = $1), 0),
            $3, $4, $5, $6, $7, $8
     RETURNING id`,
    [
      input.actionId,
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

  if (!id) throw new Error('corrective_action_event insert returned no id');

  return id;
}

export interface ReplaceAssignmentInput {
  assigneePersonId: string;
  description: string;
  dueAt: Date;
}

/**
 * Reemplaza la única asignación operativa; la guarda de 0044 la congela desde
 * `awaiting_verification`.
 */
export async function replaceAssignment(
  client: PoolClient,
  actionId: string,
  input: ReplaceAssignmentInput,
): Promise<void> {
  await client.query(
    `UPDATE corrective_action
        SET assignee_person_id = $2, description = $3, due_at = $4
      WHERE id = $1`,
    [actionId, input.assigneePersonId, input.description, input.dueAt],
  );
}

export async function insertEvidence(
  client: PoolClient,
  eventId: string,
  actionId: string,
  siteId: string,
  evidence: readonly EvidenceInput[],
): Promise<void> {
  if (evidence.length === 0) return;

  await client.query(
    `INSERT INTO corrective_action_evidence (event_id, action_id, site_id, kind, object_key)
     SELECT $1, $2, $3, k, o
       FROM unnest($4::text[], $5::text[]) AS t(k, o)`,
    [
      eventId,
      actionId,
      siteId,
      evidence.map((item) => item.kind),
      evidence.map((item) => item.object_key),
    ],
  );
}

/** Lo mínimo que el servicio necesita saber de una acción antes de tocarla. */
export interface ActionHeader {
  id: string;
  siteId: string;
  findingId: string | null;
  investigationId: string | null;
  /** El responsable vigente de la única fila operativa. */
  assigneePersonId: string;
}

export async function findActionHeader(
  client: PoolClient,
  actionId: string,
): Promise<ActionHeader | null> {
  const { rows } = await client.query<{
    site_id: string;
    finding_id: string | null;
    investigation_id: string | null;
    assignee_person_id: string;
  }>(
    `SELECT a.site_id, a.finding_id, a.investigation_id, a.assignee_person_id
       FROM corrective_action a
      WHERE a.id = $1`,
    [actionId],
  );

  const row = rows[0];

  return row
    ? {
        id: actionId,
        siteId: row.site_id,
        findingId: row.finding_id,
        investigationId: row.investigation_id,
        assigneePersonId: row.assignee_person_id,
      }
    : null;
}

/**
 * Quién declaró el trabajo hecho, para la regla "el verificador no es el ejecutor".
 *
 * Se pregunta por el autor del evento que llevó a `awaiting_verification` y no por la
 * cuenta de la persona asignada: el ejecutor real puede ser el coordinador actuando en
 * nombre de alguien sin cuenta (design D6).
 */
export async function lastExecutor(
  client: PoolClient,
  actionId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ actor_user_id: string }>(
    `SELECT e.actor_user_id
       FROM corrective_action_event e
      WHERE e.action_id = $1 AND e.to_state = 'awaiting_verification'
      ORDER BY e.position DESC
      LIMIT 1`,
    [actionId],
  );

  return rows[0]?.actor_user_id ?? null;
}

/** El detalle conserva el stream completo; el listado usa una proyección aparte. */
const ACTION_SELECT = `
  SELECT a.id, a.site_id, a.finding_id, a.investigation_id,
         a.assignee_person_id, a.description, a.due_at,
         a.remediation_group_id, a.created_by, a.created_at,
         s.to_state AS state,
         (a.due_at < now()) AS overdue,
         COALESCE(ev.events, '[]'::jsonb) AS events,
         COALESCE(esc.escalations, '[]'::jsonb) AS escalations
    FROM corrective_action a
    LEFT JOIN LATERAL (
      SELECT e.to_state FROM corrective_action_event e
       WHERE e.action_id = a.id
       ORDER BY e.position DESC
       LIMIT 1
    ) s ON true
    LEFT JOIN LATERAL (
      -- Ordenado por la posición NUMÉRICA. Ordenar por el texto del jsonb pondría la
      -- transición 10 antes de la 2, y el stream de una acción con historia larga se
      -- leería desordenado sin que nada falle.
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
                   'recorded_at', e.recorded_at,
                   'evidence', COALESCE(
                     (SELECT jsonb_agg(jsonb_build_object(
                                'id', v.id, 'kind', v.kind,
                                'object_key', v.object_key, 'created_at', v.created_at)
                              ORDER BY v.created_at, v.id)
                        FROM corrective_action_evidence v WHERE v.event_id = e.id),
                     '[]'::jsonb)) AS row
            FROM corrective_action_event e
           WHERE e.action_id = a.id
        ) rows
    ) ev ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'level', x.level, 'days_overdue', x.days_overdue,
               'escalated_at', x.escalated_at) ORDER BY x.escalated_at) AS escalations
        FROM corrective_action_escalation x WHERE x.action_id = a.id
    ) esc ON true`;

/**
 * La cola operativa resuelve su contexto en una consulta y no descarga el stream.
 * Ningún join agrega un filtro de sitio: cada tabla aislada sigue bajo RLS (ADR-004).
 */
const ACTION_SUMMARY_SELECT = `
  SELECT a.id, a.site_id, site.name AS site_name,
         a.finding_id, a.investigation_id, a.assignee_person_id,
         CASE WHEN person.id IS NULL THEN NULL
              ELSE person.first_name || ' ' || person.last_name END AS assignee_name,
         a.description, a.due_at,
         state.to_state AS state,
         (a.due_at < now()) AS overdue,
         COALESCE(esc.escalations, '[]'::jsonb) AS escalations,
         finding.inspection_id,
         inspection.scheduled_inspection_id,
         scheduled.template_id,
         template.name AS template_name
    FROM corrective_action a
    JOIN site ON site.id = a.site_id
    LEFT JOIN person ON person.id = a.assignee_person_id
    LEFT JOIN finding ON finding.id = a.finding_id
    LEFT JOIN inspection ON inspection.id = finding.inspection_id
    LEFT JOIN scheduled_inspection scheduled ON scheduled.id = inspection.scheduled_inspection_id
    LEFT JOIN template ON template.id = scheduled.template_id
    LEFT JOIN LATERAL (
      SELECT event.to_state FROM corrective_action_event event
       WHERE event.action_id = a.id
       ORDER BY event.position DESC
       LIMIT 1
    ) state ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object(
               'level', escalation.level,
               'days_overdue', escalation.days_overdue,
               'escalated_at', escalation.escalated_at)
               ORDER BY escalation.escalated_at) AS escalations
        FROM corrective_action_escalation escalation
       WHERE escalation.action_id = a.id
    ) esc ON true`;

export async function listActions(client: PoolClient): Promise<ActionSummary[]> {
  const { rows } = await client.query<ActionSummaryRow>(
    `${ACTION_SUMMARY_SELECT} ORDER BY a.due_at, a.id`,
  );

  return rows.map(toActionSummary);
}

export async function readAction(client: PoolClient, actionId: string): Promise<Action | null> {
  const { rows } = await client.query<ActionRow>(`${ACTION_SELECT} WHERE a.id = $1`, [actionId]);
  const row = rows[0];

  return row ? toAction(row) : null;
}

interface RawEvent {
  id: string;
  position: number;
  from_state: ActionState | null;
  to_state: ActionState;
  actor_user_id: string;
  note: string | null;
  reason: string | null;
  occurred_at: string;
  recorded_at: string;
  evidence: { id: string; kind: 'before' | 'after'; object_key: string; created_at: string }[];
}

interface RawEscalation {
  level: EscalationLevel;
  days_overdue: number;
  escalated_at: string;
}

interface ActionRow {
  id: string;
  site_id: string;
  finding_id: string | null;
  investigation_id: string | null;
  assignee_person_id: string;
  description: string;
  due_at: Date;
  remediation_group_id: string | null;
  created_by: string;
  created_at: Date;
  state: ActionState;
  overdue: boolean;
  events: RawEvent[];
  escalations: RawEscalation[];
}

interface ActionSummaryRow {
  id: string;
  site_id: string;
  site_name: string;
  finding_id: string | null;
  investigation_id: string | null;
  assignee_person_id: string;
  assignee_name: string | null;
  description: string;
  due_at: Date;
  state: ActionState;
  overdue: boolean;
  escalations: RawEscalation[];
  inspection_id: string | null;
  scheduled_inspection_id: string | null;
  template_id: string | null;
  template_name: string | null;
}

function toActionSummary(row: ActionSummaryRow): ActionSummary {
  const common = {
    id: row.id,
    site_id: row.site_id,
    site_name: row.site_name,
    assignee_person_id: row.assignee_person_id,
    assignee_name: row.assignee_name,
    description: row.description,
    due_at: row.due_at.toISOString(),
    state: row.state,
    overdue: row.overdue,
    escalations: row.escalations.map((item) => ({
      level: item.level,
      days_overdue: item.days_overdue,
      escalated_at: new Date(item.escalated_at).toISOString(),
    })),
  };

  if (row.investigation_id !== null) {
    return {
      ...common,
      source: { kind: 'investigation', investigation_id: row.investigation_id },
    };
  }

  if (row.finding_id === null) throw new Error(`Action ${row.id} has no parent`);

  if (row.inspection_id === null) {
    return {
      ...common,
      source: { kind: 'manual_finding', finding_id: row.finding_id },
    };
  }

  if (
    row.scheduled_inspection_id === null ||
    row.template_id === null ||
    row.template_name === null
  ) {
    throw new Error(`Inspection source for action ${row.id} is incomplete`);
  }

  return {
    ...common,
    source: {
      kind: 'inspection',
      finding_id: row.finding_id,
      inspection_id: row.inspection_id,
      scheduled_inspection_id: row.scheduled_inspection_id,
      template_id: row.template_id,
      template_name: row.template_name,
    },
  };
}

function toAction(row: ActionRow): Action {
  return {
    id: row.id,
    site_id: row.site_id,
    finding_id: row.finding_id,
    investigation_id: row.investigation_id,
    assignee_person_id: row.assignee_person_id,
    description: row.description,
    due_at: row.due_at.toISOString(),
    remediation_group_id: row.remediation_group_id,
    created_by: row.created_by,
    created_at: row.created_at.toISOString(),
    // Derivado del último evento. La restricción diferida de 0011 garantiza que hay uno.
    state: row.state,
    overdue: row.overdue,
    events: row.events.map(toEvent),
    escalations: row.escalations.map((item) => ({
      level: item.level,
      days_overdue: item.days_overdue,
      escalated_at: new Date(item.escalated_at).toISOString(),
    })),
  };
}

function toEvent(raw: RawEvent): ActionEvent {
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
    evidence: raw.evidence.map((item) => ({
      id: item.id,
      kind: item.kind,
      object_key: item.object_key,
      created_at: new Date(item.created_at).toISOString(),
    })),
  };
}
