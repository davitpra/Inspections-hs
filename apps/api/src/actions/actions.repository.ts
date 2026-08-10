import type { PoolClient } from 'pg';
import type {
  Action,
  ActionEvent,
  ActionState,
  EscalationLevel,
  EvidenceInput,
  Severity,
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
  findingId: string;
  assigneePersonId: string;
  description: string;
  severity: Severity;
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
       (site_id, finding_id, assignee_person_id, description, severity, due_at,
        remediation_group_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      input.siteId,
      input.findingId,
      input.assigneePersonId,
      input.description,
      input.severity,
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
  assigneePersonId: string;
}

export async function findActionHeader(
  client: PoolClient,
  actionId: string,
): Promise<ActionHeader | null> {
  const { rows } = await client.query<{ site_id: string; assignee_person_id: string }>(
    `SELECT site_id, assignee_person_id FROM corrective_action WHERE id = $1`,
    [actionId],
  );

  const row = rows[0];

  return row
    ? { id: actionId, siteId: row.site_id, assigneePersonId: row.assignee_person_id }
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

/**
 * El listado, con el estado derivado, el stream completo y los escalamientos.
 *
 * El estado sale de `DISTINCT ON` sobre los eventos —no de una columna, que no
 * existe— y `overdue` de comparar `due_at` con el reloj del servidor al leer.
 */
const ACTION_SELECT = `
  SELECT a.id, a.site_id, a.finding_id, a.assignee_person_id, a.description, a.severity,
         a.due_at, a.remediation_group_id, a.created_by, a.created_at,
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

export async function listActions(client: PoolClient): Promise<Action[]> {
  const { rows } = await client.query<ActionRow>(`${ACTION_SELECT} ORDER BY a.due_at`);

  return rows.map(toAction);
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
  finding_id: string;
  assignee_person_id: string;
  description: string;
  severity: Severity;
  due_at: Date;
  remediation_group_id: string | null;
  created_by: string;
  created_at: Date;
  state: ActionState;
  overdue: boolean;
  events: RawEvent[];
  escalations: RawEscalation[];
}

function toAction(row: ActionRow): Action {
  return {
    id: row.id,
    site_id: row.site_id,
    finding_id: row.finding_id,
    assignee_person_id: row.assignee_person_id,
    description: row.description,
    severity: row.severity,
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
