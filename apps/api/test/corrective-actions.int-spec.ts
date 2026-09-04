import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { InspectionSubmission, TemplateDocument } from '@hs/contracts';
import { ACTION_STATES, TRANSITIONS, transitionFor, type ActionState } from '@hs/contracts';

import { ActionsService } from '../src/actions/actions.service';
import { EscalationService } from '../src/actions/escalation.service';
import { FindingsService } from '../src/findings/findings.service';
import { SubmissionsService } from '../src/inspections/submissions.service';
import { createLocation, registerSite } from './helpers/catalog';
import { createAccount, createPerson } from './helpers/identity';
import { scheduleInspection } from './helpers/inspections';
import { inScope, one, sqlstate, startTestDatabase, type TestDatabase } from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';
import { createTemplate, publishVersion, registerItems } from './helpers/templates';

/**
 * Requisitos §7 etapa 5 — La acción correctiva y su cierre verificado (§3 R3).
 *
 * Lo que estos tests prueban no es que se guarden filas. Es que las propiedades que
 * hacen que R3 signifique algo se cumplan aunque el cliente se porte mal y aunque
 * alguien escriba SQL a mano:
 *
 *   1. El estado sale de los eventos y no de ninguna columna.
 *   2. Solo las cinco transiciones existen, por el endpoint y por `INSERT` directo.
 *   3. Dos transiciones concurrentes no bifurcan el stream.
 *   4. Quien ejecutó no puede verificar, ni siquiera insertando a mano.
 *   5. Declarar el trabajo hecho sin evidencia commitea y conserva evidencia opcional.
 *   6. El plazo declarado queda congelado desde la creación.
 *   7. Treinta corridas del cron escalan una vez por nivel.
 */

const SITE_A = 'ac700000-0000-4000-8000-000000000001';
const SITE_B = 'ac700000-0000-4000-8000-000000000002';
const DUE_AT = '2050-01-01T17:00:00.000Z';
const LATER_DUE_AT = '2050-02-01T17:00:00.000Z';

let db: TestDatabase;
let stack: SchedulingStack;
let submissions: SubmissionsService;
let findings: FindingsService;
let actions: ActionsService;
let escalation: EscalationService;

let templateId: string;
let versionId: string;
let locationA: string;
let locationB: string;

let inspector: { accountId: string };
let coordinator: { accountId: string };
let supervisor: { accountId: string; personId: string };
let otherSupervisor: { accountId: string; personId: string };
let manager: { accountId: string; personId: string };
let auditor: { accountId: string };
let jhsc: { accountId: string };
let inspectorB: { accountId: string };

/** Una persona del roster sin cuenta: el caso normal con 200 personas y 20 usuarios. */
let rosterPerson: string;
let rosterPersonB: string;

const ITEM_KEYS = ['act.guards'];

function document(): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'act.guards',
            prompt: 'Machine guards in place',
            position: 1,
            required: true,
            response_type: 'yes_no' as const,
            fails_on: 'no' as const,
          },
        ],
      },
    ],
  };
}

const sessionFor = (accountId: string, role: string, siteIds: string[]) => ({
  userId: accountId,
  role,
  siteIds,
});

const asCoordinator = () => sessionFor(coordinator.accountId, 'hs_coordinator', [SITE_A, SITE_B]);
const asSupervisor = () => sessionFor(supervisor.accountId, 'supervisor', [SITE_A]);
const asOtherSupervisor = () => sessionFor(otherSupervisor.accountId, 'supervisor', [SITE_A]);
const asManager = () => sessionFor(manager.accountId, 'management', [SITE_A]);

let periodCursor = 0;

function nextPeriod(): string {
  periodCursor += 1;
  const month = ((periodCursor - 1) % 12) + 1;
  const year = 2040 + Math.floor((periodCursor - 1) / 12);

  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Un hallazgo derivado de un envío real, todavía sin ninguna clasificación. */
async function derivedFinding(
  siteId = SITE_A,
): Promise<{ findingId: string; reporterAccountId: string }> {
  const isB = siteId === SITE_B;
  const location = isB ? locationB : locationA;
  const account = isB ? inspectorB : inspector;
  const scheduled = await scheduleInspection(db.app, {
    siteId,
    periodStart: nextPeriod(),
    templateId,
    templateVersionId: versionId,
    inspectorId: account.accountId,
  });

  const payload: InspectionSubmission = {
    client_submission_id: randomUUID(),
    scheduled_inspection_id: scheduled,
    template_version_id: versionId,
    answers: { 'act.guards': false } as InspectionSubmission['answers'],
    photos: {},
    findings: {
      'act.guards': {
        description: 'Guard missing on the infeed of packaging line 3',
        location_id: location,
        photo_object_keys: [`${siteId}/${scheduled}/${randomUUID()}`],
      },
    },
    signed_at: '2026-08-03T14:20:00-04:00',
  };

  const accepted = await submissions.ingest(
    sessionFor(account.accountId, 'jhsc_member', [siteId]),
    payload,
  );

  const rows = await inScope<{ id: string }>(
    db.app,
    [siteId],
    'SELECT id FROM finding WHERE inspection_id = $1',
    [accepted.id],
  );

  const findingId = one(rows).id;

  return { findingId, reporterAccountId: account.accountId };
}

/** Una acción abierta sobre un hallazgo nuevo, con el responsable pedido. */
async function openAction(
  options: { assignee?: string; siteId?: string; dueAt?: string } = {},
): Promise<string> {
  const siteId = options.siteId ?? SITE_A;
  const { findingId } = await derivedFinding(siteId);

  const action = await actions.create(asCoordinator(), findingId, {
    assignee_person_id:
      options.assignee ?? (siteId === SITE_B ? rosterPersonB : supervisor.personId),
    description: 'Install a fixed guard on the infeed of line 3',
    due_at: options.dueAt ?? DUE_AT,
  });

  return action.id;
}

async function openManualAction(): Promise<string> {
  const draftId = randomUUID();
  const finding = await findings.report(asSupervisor(), {
    site_id: SITE_A,
    draft_finding_id: draftId,
    details: {
      description: 'Damaged dock barrier found outside the inspection route',
      location_id: locationA,
      photo_object_keys: [`${SITE_A}/manual/${draftId}/${randomUUID()}`],
    },
    occurred_at: '2026-08-04T10:00:00-04:00',
  });
  const action = await actions.create(asCoordinator(), finding.id, {
    assignee_person_id: supervisor.personId,
    description: 'Replace the damaged barrier at the loading dock',
    due_at: DUE_AT,
  });

  return action.id;
}

/**
 * Vencer una acción sin esperar tres días: el trabajo recibe `now` por payload, así que
 * se lo sitúa en el futuro. Es la misma puerta que usa la recuperación manual del día
 * que el planificador estuvo caído.
 */
function daysAfter(dueAt: string, days: number): Date {
  return new Date(new Date(dueAt).getTime() + days * 24 * 60 * 60 * 1000);
}

/** Una object key bajo el prefijo de la acción, que es lo que el servidor firma. */
const evidenceKey = (actionId: string, siteId = SITE_A) =>
  `${siteId}/actions/${actionId}/${randomUUID()}`;

/**
 * Lleva una acción hasta `awaiting_verification`, ejecutada por el supervisor.
 */
async function awaitingVerification(actionId: string): Promise<void> {
  await actions.transition(asSupervisor(), actionId, {
    to: 'in_progress',
    evidence: [],
  });
  await actions.transition(asSupervisor(), actionId, {
    to: 'awaiting_verification',
    evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
  });
}

async function stateOf(actionId: string, siteIds = [SITE_A]): Promise<string> {
  const rows = await inScope<{ to_state: string }>(
    db.app,
    siteIds,
    `SELECT DISTINCT ON (e.action_id) e.to_state
       FROM corrective_action_event e
      WHERE e.action_id = $1
      ORDER BY e.action_id, e.position DESC`,
    [actionId],
  );

  return one(rows).to_state;
}

async function eventRows(actionId: string, siteIds = [SITE_A]) {
  return inScope<{
    id: string;
    position: number;
    from_state: string | null;
    to_state: string;
    actor_user_id: string;
    reason: string | null;
  }>(
    db.app,
    siteIds,
    `SELECT id, position, from_state, to_state, actor_user_id, reason
       FROM corrective_action_event WHERE action_id = $1 ORDER BY position`,
    [actionId],
  );
}

async function findingStateOf(findingId: string, siteIds = [SITE_A]): Promise<string> {
  const rows = await inScope<{ to_state: string }>(
    db.app,
    siteIds,
    `SELECT to_state
       FROM finding_state_event
      WHERE finding_id = $1
      ORDER BY position DESC
      LIMIT 1`,
    [findingId],
  );

  return one(rows).to_state;
}

async function findingStateRows(findingId: string, siteIds = [SITE_A]) {
  return inScope<{
    id: string;
    position: number;
    from_state: string | null;
    to_state: string;
    source_action_event_id: string | null;
    actor_user_id: string | null;
  }>(
    db.app,
    siteIds,
    `SELECT id, position, from_state, to_state, source_action_event_id, actor_user_id
       FROM finding_state_event
      WHERE finding_id = $1
      ORDER BY position`,
    [findingId],
  );
}

async function auditEvents(siteId: string, type: string) {
  return inScope<{ seq: string; payload: Record<string, unknown>; actor_user_id: string | null }>(
    db.app,
    [siteId],
    `SELECT seq, payload, actor_user_id FROM audit_log
      WHERE site_id = $1 AND event_type = $2 ORDER BY seq`,
    [siteId, type],
  );
}

async function chainLength(siteId: string): Promise<number> {
  const rows = await inScope<{ count: string }>(
    db.app,
    [siteId],
    'SELECT count(*)::text AS count FROM audit_log WHERE site_id = $1',
    [siteId],
  );

  return Number(one(rows).count);
}

/** Sin filas significa cadena intacta: la función devuelve el primer eslabón roto. */
async function chainIsIntact(siteId: string): Promise<boolean> {
  const rows = await inScope(db.app, [siteId], 'SELECT * FROM hs_audit_verify_chain($1)', [siteId]);

  return rows.length === 0;
}

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createSchedulingStack(db.appUrl);
  submissions = new SubmissionsService(stack.db);
  findings = new FindingsService(stack.db);
  actions = new ActionsService(stack.db);
  escalation = new EscalationService(stack.db, stack.jobs);

  await registerSite(db.migrator, SITE_A, 'act-a');
  await registerSite(db.migrator, SITE_B, 'act-b');

  locationA = await createLocation(db.app, SITE_A, 'dock-1', 'Dock 1');
  locationB = await createLocation(db.app, SITE_B, 'dock-1', 'Dock 1');

  templateId = await createTemplate(db.migrator, 'act-template', 'Monthly walkthrough');
  await registerItems(db.migrator, templateId, ITEM_KEYS);
  versionId = await publishVersion(db.migrator, templateId, 1, document());

  inspector = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  inspectorB = await createAccount(db.app, { siteIds: [SITE_B], role: 'jhsc_member' });
  coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'hs_coordinator',
    firstName: 'Casey',
    lastName: 'Coordinator',
  });
  supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
  otherSupervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
  manager = await createAccount(db.app, { siteIds: [SITE_A], role: 'management' });
  jhsc = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  auditor = await createAccount(db.app, {
    siteIds: [SITE_A],
    role: 'external_auditor',
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    recordsFrom: '2026-01-01',
    recordsTo: '2026-12-31',
  });

  rosterPerson = await createPerson(db.app, SITE_A);
  rosterPersonB = await createPerson(db.app, SITE_B);
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

describe('el estado propio del hallazgo', () => {
  it('nace raised y recorre automáticamente las etapas con su acción', async () => {
    const { findingId, reporterAccountId } = await derivedFinding();

    expect((await findings.get(asCoordinator(), findingId)).state).toBe('raised');

    const created = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });

    expect(await findingStateOf(findingId)).toBe('assigned');

    await actions.transition(asSupervisor(), created.id, { to: 'in_progress', evidence: [] });
    expect(await findingStateOf(findingId)).toBe('in_progress');

    await actions.transition(asSupervisor(), created.id, {
      to: 'awaiting_verification',
      evidence: [],
    });
    expect(await findingStateOf(findingId)).toBe('verification');

    await actions.transition(asCoordinator(), created.id, { to: 'closed', evidence: [] });
    expect((await findings.get(asCoordinator(), findingId)).state).toBe('closed');

    const stream = await findingStateRows(findingId);
    expect(stream.map(({ from_state, to_state }) => [from_state, to_state])).toEqual([
      [null, 'raised'],
      ['raised', 'assigned'],
      ['assigned', 'in_progress'],
      ['in_progress', 'verification'],
      ['verification', 'closed'],
    ]);
    expect(stream[0]?.actor_user_id).toBe(reporterAccountId);
    expect(stream.slice(1).every((event) => event.source_action_event_id !== null)).toBe(true);
  });

  it('regresa a in_progress si se rechaza la verificación', async () => {
    const { findingId } = await derivedFinding();
    const created = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });
    await awaitingVerification(created.id);

    await actions.transition(asOtherSupervisor(), created.id, {
      to: 'in_progress',
      reason: 'The guard was installed on the wrong line',
      evidence: [],
    });

    expect(await findingStateOf(findingId)).toBe('in_progress');
  });

  it('una acción nueva devuelve un hallazgo cerrado a assigned', async () => {
    const { findingId } = await derivedFinding();
    const first = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });
    await awaitingVerification(first.id);
    await actions.transition(asCoordinator(), first.id, { to: 'closed', evidence: [] });

    await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Add a documented pre-start inspection of the new guard',
      due_at: LATER_DUE_AT,
    });

    expect(await findingStateOf(findingId)).toBe('assigned');
  });

  it('no duplica eventos mientras otra acción menos avanzada retiene el estado', async () => {
    const { findingId } = await derivedFinding();
    const first = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });
    await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Document the guard inspection procedure for the line',
      due_at: LATER_DUE_AT,
    });

    await actions.transition(asSupervisor(), first.id, { to: 'in_progress', evidence: [] });
    await actions.transition(asSupervisor(), first.id, {
      to: 'awaiting_verification',
      evidence: [],
    });

    expect(await findingStateOf(findingId)).toBe('assigned');
    expect(await findingStateRows(findingId)).toHaveLength(2);
  });

  it('serializa el avance concurrente de dos acciones del mismo hallazgo', async () => {
    const { findingId } = await derivedFinding();
    const first = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });
    const second = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Document the guard inspection procedure for the line',
      due_at: LATER_DUE_AT,
    });

    await Promise.all([
      actions.transition(asSupervisor(), first.id, { to: 'in_progress', evidence: [] }),
      actions.transition(asSupervisor(), second.id, { to: 'in_progress', evidence: [] }),
    ]);
    await Promise.all([
      actions.transition(asSupervisor(), first.id, { to: 'awaiting_verification', evidence: [] }),
      actions.transition(asSupervisor(), second.id, { to: 'awaiting_verification', evidence: [] }),
    ]);

    expect(await findingStateOf(findingId)).toBe('verification');
    expect((await findingStateRows(findingId)).map((event) => event.to_state)).toEqual([
      'raised',
      'assigned',
      'in_progress',
      'verification',
    ]);
  });

  it('audita el origen y cada cambio con el evento de acción que lo causó', async () => {
    const before = (await auditEvents(SITE_A, 'finding.state_changed')).length;
    const { findingId } = await derivedFinding();
    await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });

    const recorded = (await auditEvents(SITE_A, 'finding.state_changed')).slice(before);

    expect(recorded).toHaveLength(2);
    expect(recorded.map((event) => event.payload.to_state)).toEqual(['raised', 'assigned']);
    expect(recorded[0]?.payload.source_action_event_id).toBeNull();
    expect(recorded[1]?.payload.source_action_event_id).toEqual(expect.any(String));
  });

  it('aísla el stream por sitio y rechaza cualquier mutación', async () => {
    const { findingId } = await derivedFinding(SITE_B);
    const visible = await findingStateRows(findingId, [SITE_B]);

    expect(visible).toHaveLength(1);
    expect(await findingStateRows(findingId, [SITE_A])).toEqual([]);

    await expect(
      inScope(db.app, [SITE_B], `UPDATE finding_state_event SET to_state = 'closed' WHERE id = $1`, [
        visible[0]?.id,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === '42501');

    await expect(
      inScope(db.migrator, [SITE_B], 'DELETE FROM finding_state_event WHERE id = $1', [
        visible[0]?.id,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS001');
  });

  it('el motor rechaza un estado fabricado que no coincide con las acciones', async () => {
    const { findingId } = await derivedFinding();
    const created = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO finding_state_event
           (finding_id, site_id, position, from_state, to_state, source_action_event_id,
            actor_user_id, occurred_at, recorded_at)
         SELECT $1, event.site_id, 2, 'assigned', 'closed', event.id,
                event.actor_user_id, event.occurred_at, event.recorded_at
           FROM corrective_action_event event
          WHERE event.action_id = $2 AND event.position = 0`,
        [findingId, created.id],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS008');

    expect(await findingStateOf(findingId)).toBe('assigned');
  });
});

describe('el esquema después de retirar la clasificación', () => {
  it('elimina la tabla, las funciones y la columna sin abrir la acción', async () => {
    const table = await db.migrator.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.finding_risk_assessment') AS table_name`,
    );
    const functions = await db.migrator.query<{ name: string }>(
      `SELECT p.oid::regprocedure::text AS name
         FROM pg_proc p
        WHERE p.proname IN ('hs_finding_assessment_guard',
                            'hs_finding_assessment_audit', 'hs_risk_level')
        ORDER BY p.proname`,
    );
    const columns = await db.migrator.query<{ column_name: string }>(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'corrective_action'
          AND column_name = 'severity'`,
    );
    const privileges = await db.migrator.query<{ can_update: boolean; can_delete: boolean }>(
      `SELECT has_table_privilege('hs_app', 'public.corrective_action', 'UPDATE') AS can_update,
              has_table_privilege('hs_app', 'public.corrective_action', 'DELETE') AS can_delete`,
    );
    const policies = await db.migrator.query<{ count: string }>(
      `SELECT count(*)::text AS count
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'corrective_action'`,
    );

    expect(table.rows[0]?.table_name).toBeNull();
    expect(functions.rows).toHaveLength(0);
    expect(columns.rows).toHaveLength(0);
    expect(privileges.rows[0]).toEqual({ can_update: false, can_delete: false });
    expect(Number(policies.rows[0]?.count)).toBeGreaterThan(0);
  });
});

describe('el esquema con evidencia de cierre opcional', () => {
  it('retira solo la compuerta y conserva índices, auditoría y aislamiento', async () => {
    const functions = await db.migrator.query<{ name: string }>(
      `SELECT p.proname AS name
         FROM pg_proc p
        WHERE p.proname IN ('hs_action_evidence_required', 'hs_action_verifier_guard')
        ORDER BY p.proname`,
    );
    const triggers = await db.migrator.query<{ name: string }>(
      `SELECT tgname AS name
         FROM pg_trigger
        WHERE NOT tgisinternal
          AND tgname IN ('corrective_action_evidence_required',
                         'corrective_action_evidence_audit',
                         'corrective_action_event_verifier_guard')
        ORDER BY tgname`,
    );
    const indexes = await db.migrator.query<{ name: string }>(
      `SELECT indexname AS name
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname IN ('corrective_action_evidence_key_uq',
                            'corrective_action_evidence_event_idx')
        ORDER BY indexname`,
    );
    const policies = await db.migrator.query<{ table_name: string; count: string }>(
      `SELECT tablename AS table_name, count(*)::text AS count
         FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename IN ('corrective_action', 'corrective_action_event',
                            'corrective_action_evidence')
        GROUP BY tablename
        ORDER BY tablename`,
    );

    expect(functions.rows).toEqual([{ name: 'hs_action_verifier_guard' }]);
    expect(triggers.rows).toEqual([
      { name: 'corrective_action_event_verifier_guard' },
      { name: 'corrective_action_evidence_audit' },
    ]);
    expect(indexes.rows).toEqual([
      { name: 'corrective_action_evidence_event_idx' },
      { name: 'corrective_action_evidence_key_uq' },
    ]);
    expect(policies.rows).toHaveLength(3);
    expect(policies.rows.every((row) => Number(row.count) > 0)).toBe(true);
  });
});

describe('el recorrido completo de R3', () => {
  it('abre, ejecuta, verifica y cierra, con el estado derivado en cada paso', async () => {
    const actionId = await openAction();

    expect(await stateOf(actionId)).toBe('open');

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    expect(await stateOf(actionId)).toBe('in_progress');

    await actions.transition(asSupervisor(), actionId, {
      to: 'awaiting_verification',
      evidence: [
        { kind: 'before', object_key: evidenceKey(actionId) },
        { kind: 'after', object_key: evidenceKey(actionId) },
      ],
    });
    expect(await stateOf(actionId)).toBe('awaiting_verification');

    // Una persona DISTINTA del ejecutor. Es la mitad de R3 que no es la evidencia.
    const closed = await actions.transition(asCoordinator(), actionId, {
      to: 'closed',
      evidence: [],
    });

    expect(closed.state).toBe('closed');

    const events = await eventRows(actionId);

    expect(events.map((row) => row.to_state)).toEqual([
      'open',
      'in_progress',
      'awaiting_verification',
      'closed',
    ]);
    expect(events.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    expect(one(events).from_state).toBeNull();
    expect(events[3]?.actor_user_id).toBe(coordinator.accountId);
  });

  it('no hay ninguna columna de estado que leer', async () => {
    const rows = await inScope<{ column_name: string }>(
      db.app,
      [SITE_A],
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'corrective_action'`,
    );

    const names = rows.map((row) => row.column_name);

    expect(names).not.toContain('status');
    expect(names).not.toContain('state');
    expect(names).not.toContain('current_state');
  });

  it('el listado reporta el estado derivado y si está vencida', async () => {
    const actionId = await openAction();
    const listed = await actions.list(asCoordinator());
    const found = listed.find((item) => item.id === actionId);

    expect(found?.state).toBe('open');
    expect(found?.overdue).toBe(false);
    expect(found?.site_name).toBe('act-a');
    expect(found?.assignee_name).not.toBeNull();
    expect(found?.source).toMatchObject({
      kind: 'inspection',
      finding_id: expect.any(String),
      inspection_id: expect.any(String),
      scheduled_inspection_id: expect.any(String),
      template_id: templateId,
      template_name: 'Monthly walkthrough',
    });
    expect(found).not.toHaveProperty('events');
  });

  it('el listado distingue un hallazgo manual sin inventarle una plantilla', async () => {
    const actionId = await openManualAction();
    const listed = await actions.list(asCoordinator());

    expect(listed.find((item) => item.id === actionId)?.source).toMatchObject({
      kind: 'manual_finding',
      finding_id: expect.any(String),
    });
  });
});

describe('la máquina de estados', () => {
  it('una acción abierta no puede saltar a cerrada', async () => {
    const actionId = await openAction();

    await expect(
      actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'invalid_transition' } });

    expect(await stateOf(actionId)).toBe('open');
  });

  it('una acción cerrada no acepta nada más', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    for (const to of ACTION_STATES) {
      await expect(
        actions.transition(asCoordinator(), actionId, { to, evidence: [] }),
      ).rejects.toMatchObject({ response: { code: 'invalid_transition' } });
    }
  });

  /**
   * LA AFIRMACIÓN CENTRAL DE D4: las dos implementaciones de la tabla de transiciones
   * —la de `@hs/contracts` y la guarda de 0011— aceptan exactamente los mismos pares.
   *
   * Se evalúan los 20 pares ordenados de los cuatro estados por los dos caminos, igual
   * que 0010 compara las 25 celdas de la matriz de riesgo. Sin esto, la duplicación
   * sería deuda en vez de defensa.
   */
  it('la función pura y la guarda de SQL aceptan los mismos pares', async () => {
    const froms: (ActionState | null)[] = [null, ...ACTION_STATES];

    for (const from of froms) {
      for (const to of ACTION_STATES) {
        const allowedByEngine = await inScope<{ allowed: boolean }>(
          db.app,
          [SITE_A],
          `SELECT EXISTS (
             SELECT 1 FROM (VALUES
               (NULL, 'open'),
               ('open', 'in_progress'),
               ('in_progress', 'awaiting_verification'),
               ('awaiting_verification', 'closed'),
               ('awaiting_verification', 'in_progress')
             ) AS allowed(from_state, to_state)
              WHERE allowed.from_state IS NOT DISTINCT FROM $1::text
                AND allowed.to_state = $2::text) AS allowed`,
          [from, to],
        );

        expect(one(allowedByEngine).allowed).toBe(transitionFor(from, to) !== undefined);
      }
    }

    // Y que la tabla del contrato sea exactamente la que este test enumera.
    expect(TRANSITIONS).toHaveLength(5);
  });

  it('un INSERT directo con una transición prohibida falla con HS004', async () => {
    const actionId = await openAction();

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 1, 'open', 'closed', $3, now())`,
        [actionId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS004');
  });

  it('un evento cuyo from_state no es el vigente falla con HS004', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asSupervisor(), actionId, {
      to: 'awaiting_verification',
      evidence: [],
    });

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 3, 'open', 'awaiting_verification', $3, now())`,
        [actionId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS004');
  });

  it('un evento con un hueco en la posición falla con HS004', async () => {
    const actionId = await openAction();

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 99, 'open', 'awaiting_verification', $3, now())`,
        [actionId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS004');
  });

  /**
   * D2 — la carrera la cierra el único `(action_id, position)`, no la guarda.
   *
   * Dos transacciones que empiezan desde el mismo estado leen la misma "última
   * posición" y las dos pasan el trigger; la segunda muere al escribir. Si en vez de
   * eso el stream se bifurcara, la acción tendría dos estados vigentes y `DISTINCT ON`
   * devolvería uno de los dos según el plan de la consulta.
   */
  it('dos transiciones simultáneas: una comete y la otra falla', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    const results = await Promise.allSettled([
      actions.transition(asSupervisor(), actionId, { to: 'awaiting_verification', evidence: [] }),
      actions.transition(asCoordinator(), actionId, { to: 'awaiting_verification', evidence: [] }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const rejected = results.find((result) => result.status === 'rejected');

    expect(rejected).toBeDefined();
    expect(await eventRows(actionId)).toHaveLength(3);
    expect(await stateOf(actionId)).toBe('awaiting_verification');
  });
});

describe('el verificador', () => {
  it('quien declaró el trabajo hecho no puede cerrar', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    await expect(
      actions.transition(asSupervisor(), actionId, { to: 'closed', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'verifier_is_executor' } });

    expect(await stateOf(actionId)).toBe('awaiting_verification');
  });

  it('tampoco puede rechazar su propio trabajo', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    await expect(
      actions.transition(asSupervisor(), actionId, {
        to: 'in_progress',
        reason: 'the guard is on line 2, not line 3',
        evidence: [],
      }),
    ).rejects.toMatchObject({ response: { code: 'verifier_is_executor' } });
  });

  it('un INSERT directo del ejecutor falla con HS005', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 3, 'awaiting_verification', 'closed', $3, now())`,
        [actionId, SITE_A, supervisor.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS005');
  });

  it('otro supervisor sí puede cerrar', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    const closed = await actions.transition(asOtherSupervisor(), actionId, {
      to: 'closed',
      evidence: [],
    });

    expect(closed.state).toBe('closed');
  });

  it('gerencia también verifica', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    const closed = await actions.transition(asManager(), actionId, { to: 'closed', evidence: [] });

    expect(closed.state).toBe('closed');
  });

  it('rechazar devuelve a in_progress y guarda el motivo', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    const reason = 'the guard is installed on line 2, not line 3';

    await actions.transition(asCoordinator(), actionId, {
      to: 'in_progress',
      reason,
      evidence: [],
    });

    expect(await stateOf(actionId)).toBe('in_progress');

    const events = await eventRows(actionId);

    expect(events[3]?.reason).toBe(reason);
  });

  it('rechazar sin motivo se rechaza en el servicio y en el motor', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);

    await expect(
      actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'invalid_transition' } });

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 3, 'awaiting_verification', 'in_progress', $3, now())`,
        [actionId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === '23514');
  });

  /**
   * Gerencia solo puede declarar trabajo hecho cuando es la responsable de la acción —
   * `in_progress → awaiting_verification` es del `assignee` o del coordinador—, así que el caso se monta
   * asignándosela. La regla la alcanza igual que al supervisor: ADR-019 exime al
   * coordinador y a nadie más.
   */
  it('gerencia tampoco puede verificar lo que declaró hecho', async () => {
    const actionId = await openAction({ assignee: manager.personId });

    await actions.transition(asManager(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asManager(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    await expect(
      actions.transition(asManager(), actionId, { to: 'closed', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'verifier_is_executor' } });
  });

  /**
   * ADR-019 invierte el caso que D6 explicaba. Lo que D6 decidió SIGUE EN PIE: la regla se
   * compara contra el autor del evento de completado y no contra `assignee_person_id` —los
   * dos tests de arriba lo prueban con el supervisor y con gerencia—. Lo que cambia es que
   * ese caso, el coordinador ejecutando EN NOMBRE de una persona sin cuenta, es justo el que
   * dejaba trabajo terminado retenido en `awaiting_verification`: hay un solo coordinador y
   * el segundo par de ojos que la regla prometía no existía.
   */
  it('el coordinador que ejecutó en nombre de otro sí verifica', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asCoordinator(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    const closed = await actions.transition(asCoordinator(), actionId, {
      to: 'closed',
      evidence: [],
    });

    expect(closed.state).toBe('closed');

    const events = await eventRows(actionId);

    expect(events.at(-1)?.actor_user_id).toBe(coordinator.accountId);
  });

  it('el coordinador también puede rechazar su propio trabajo, con motivo', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asCoordinator(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    const reason = 'the guard is installed on line 2, not line 3';

    await actions.transition(asCoordinator(), actionId, {
      to: 'in_progress',
      reason,
      evidence: [],
    });

    expect(await stateOf(actionId)).toBe('in_progress');
    expect((await eventRows(actionId)).at(-1)?.reason).toBe(reason);
  });

  /**
   * La excepción vive en el motor y no solo en el endpoint (ADR-019): es la contracara del
   * INSERT directo del supervisor, que sigue fallando con `HS005`.
   */
  it('un INSERT directo del coordinador ejecutor commitea', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asCoordinator(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO corrective_action_event
         (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
       VALUES ($1, $2, 3, 'awaiting_verification', 'closed', $3, now())`,
      [actionId, SITE_A, coordinator.accountId],
    );

    expect(await stateOf(actionId)).toBe('closed');
  });
});

describe('la evidencia', () => {
  it('declarar el trabajo hecho sin evidencia llega a esperando verificación', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    const action = await actions.transition(asSupervisor(), actionId, {
      to: 'awaiting_verification',
      evidence: [],
    });
    const completion = action.events.find((event) => event.to_state === 'awaiting_verification');

    expect(action.state).toBe('awaiting_verification');
    expect(completion?.evidence).toEqual([]);
  });

  it('un evento directo de completado sin evidencia commitea', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    await inScope(
      db.app,
      [SITE_A],
      `INSERT INTO corrective_action_event
         (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
       VALUES ($1, $2, 2, 'in_progress', 'awaiting_verification', $3, now())`,
      [actionId, SITE_A, supervisor.accountId],
    );

    expect(await stateOf(actionId)).toBe('awaiting_verification');
  });

  it('guarda el antes y el después con su tipo', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    const action = await actions.transition(asSupervisor(), actionId, {
      to: 'awaiting_verification',
      evidence: [
        { kind: 'before', object_key: evidenceKey(actionId) },
        { kind: 'after', object_key: evidenceKey(actionId) },
        { kind: 'after', object_key: evidenceKey(actionId) },
      ],
    });

    const completion = action.events.find((event) => event.to_state === 'awaiting_verification');

    expect(completion?.evidence).toHaveLength(3);
    expect(completion?.evidence.filter((item) => item.kind === 'after')).toHaveLength(2);
  });

  it('una key de otro prefijo se rechaza', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    await expect(
      actions.transition(asSupervisor(), actionId, {
        to: 'awaiting_verification',
        evidence: [
          { kind: 'after', object_key: `${SITE_A}/actions/${randomUUID()}/${randomUUID()}` },
        ],
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_evidence' } });
  });
});

describe('la creación', () => {
  it('un hallazgo sin clasificar puede recibir acciones', async () => {
    const scheduled = await scheduleInspection(db.app, {
      siteId: SITE_A,
      periodStart: nextPeriod(),
      templateId,
      templateVersionId: versionId,
      inspectorId: inspector.accountId,
    });

    const accepted = await submissions.ingest(
      sessionFor(inspector.accountId, 'jhsc_member', [SITE_A]),
      {
        client_submission_id: randomUUID(),
        scheduled_inspection_id: scheduled,
        template_version_id: versionId,
        answers: { 'act.guards': false } as InspectionSubmission['answers'],
        photos: {},
        findings: {
          'act.guards': {
            description: 'Guard missing on the infeed of packaging line 3',
            location_id: locationA,
            photo_object_keys: [`${SITE_A}/${scheduled}/${randomUUID()}`],
          },
        },
        signed_at: '2026-08-03T14:20:00-04:00',
      },
    );

    const rows = await inScope<{ id: string }>(
      db.app,
      [SITE_A],
      'SELECT id FROM finding WHERE inspection_id = $1',
      [accepted.id],
    );

    const action = await actions.create(asCoordinator(), one(rows).id, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });

    expect(action.finding_id).toBe(one(rows).id);
    expect(action.investigation_id).toBeNull();

    const created = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM corrective_action WHERE finding_id = $1',
      [one(rows).id],
    );

    expect(Number(one(created).count)).toBe(1);
  });

  it('el coordinador declara la fecha y queda congelada', async () => {
    const { findingId } = await derivedFinding();

    const action = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Stop the line until the guard is fitted',
      due_at: DUE_AT,
    });

    expect(action.due_at).toBe(DUE_AT);

    const reread = await actions.get(asCoordinator(), action.id);

    expect(reread.due_at).toBe(DUE_AT);
  });

  it('una fecha pasada se rechaza con invalid_due_at', async () => {
    const { findingId } = await derivedFinding();

    await expect(
      actions.create(asCoordinator(), findingId, {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_due_at' } });

    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM corrective_action WHERE finding_id = $1',
      [findingId],
    );

    expect(Number(one(rows).count)).toBe(0);
  });

  it('varias acciones sobre el mismo hallazgo, cada una con su responsable', async () => {
    const { findingId } = await derivedFinding();

    for (const [assignee, dueAt] of [
      [supervisor.personId, DUE_AT],
      [rosterPerson, LATER_DUE_AT],
    ] as const) {
      await actions.create(asCoordinator(), findingId, {
        assignee_person_id: assignee,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: dueAt,
      });
    }

    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM corrective_action WHERE finding_id = $1',
      [findingId],
    );

    expect(Number(one(rows).count)).toBe(2);
  });

  it('un responsable de la otra planta se rechaza', async () => {
    const { findingId } = await derivedFinding();

    await expect(
      actions.create(asCoordinator(), findingId, {
        assignee_person_id: rosterPersonB,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_assignee' } });
  });

  it('una acción sin ningún evento no commitea (HS007)', async () => {
    const { findingId } = await derivedFinding();

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action
           (site_id, finding_id, assignee_person_id, description, due_at, created_by)
         VALUES ($1, $2, $3, 'Install a fixed guard on the infeed', $4, $5)`,
        [SITE_A, findingId, supervisor.personId, DUE_AT, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS007');
  });

  it('la remediación compartida agrupa y no cambia nada', async () => {
    const groupId = randomUUID();
    const created = [];

    for (const dueAt of [DUE_AT, LATER_DUE_AT]) {
      const { findingId } = await derivedFinding();

      created.push(
        await actions.create(asCoordinator(), findingId, {
          assignee_person_id: supervisor.personId,
          description: 'Fit guards across every packaging line',
          due_at: dueAt,
          remediation_group_id: groupId,
        }),
      );
    }

    // Cada una conserva SU fecha declarada: el grupo no las uniformó.
    expect(created.every((action) => action.remediation_group_id === groupId)).toBe(true);
    expect(new Date(created[0]!.due_at).getTime()).toBeLessThan(
      new Date(created[1]!.due_at).getTime(),
    );

    // Cerrar una no toca la otra.
    await awaitingVerification(created[0]!.id);
    await actions.transition(asCoordinator(), created[0]!.id, { to: 'closed', evidence: [] });

    expect(await stateOf(created[0]!.id)).toBe('closed');
    expect(await stateOf(created[1]!.id)).toBe('open');
  });
});

describe('los permisos', () => {
  it('un supervisor no puede abrir una acción', async () => {
    const { findingId } = await derivedFinding();

    await expect(
      actions.create(asSupervisor(), findingId, {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('quien reportó el hallazgo lo abre, aunque no sea el coordinador (ADR-017)', async () => {
    const { findingId, reporterAccountId } = await derivedFinding();

    const action = await actions.create(
      sessionFor(reporterAccountId, 'jhsc_member', [SITE_A]),
      findingId,
      {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: DUE_AT,
      },
    );

    expect(action.created_by).toBe(reporterAccountId);
  });

  it('el supervisor que reportó un hallazgo manual abre su propia acción', async () => {
    const draftId = randomUUID();
    const finding = await findings.report(asSupervisor(), {
      site_id: SITE_A,
      draft_finding_id: draftId,
      details: {
        description: 'Damaged dock barrier found outside the inspection route',
        location_id: locationA,
        photo_object_keys: [`${SITE_A}/manual/${draftId}/${randomUUID()}`],
      },
      occurred_at: '2026-08-04T10:00:00-04:00',
    });

    const action = await actions.create(asSupervisor(), finding.id, {
      assignee_person_id: supervisor.personId,
      description: 'Replace the damaged barrier at the loading dock',
      due_at: DUE_AT,
    });

    expect(action.created_by).toBe(supervisor.accountId);
  });

  it('otro miembro del JHSC que no reportó el hallazgo no puede abrir la acción', async () => {
    const { findingId } = await derivedFinding();

    await expect(
      actions.create(sessionFor(jhsc.accountId, 'jhsc_member', [SITE_A]), findingId, {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('un hallazgo fuera de alcance responde que no existe, no que está prohibido', async () => {
    const { findingId, reporterAccountId } = await derivedFinding(SITE_B);

    await expect(
      actions.create(sessionFor(reporterAccountId, 'jhsc_member', [SITE_A]), findingId, {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'action_not_found' } });
  });

  it('un supervisor que no es el responsable no puede avanzarla', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await expect(
      actions.transition(asSupervisor(), actionId, {
        to: 'in_progress',
        evidence: [],
      }),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('el coordinador avanza en nombre de una persona sin cuenta', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] });
    const action = await actions.transition(asCoordinator(), actionId, {
      to: 'awaiting_verification',
      evidence: [],
    });

    expect(action.state).toBe('awaiting_verification');
    expect(action.events[2]?.actor_user_id).toBe(coordinator.accountId);
  });

  it('un miembro del JHSC y un auditor externo no escriben nada', async () => {
    const actionId = await openAction();

    for (const session of [
      sessionFor(jhsc.accountId, 'jhsc_member', [SITE_A]),
      sessionFor(auditor.accountId, 'external_auditor', [SITE_A]),
    ]) {
      await expect(
        actions.transition(session, actionId, { to: 'in_progress', evidence: [] }),
      ).rejects.toMatchObject({ response: { code: 'forbidden' } });
    }
  });
});

describe('el aislamiento por planta', () => {
  it('un supervisor de una planta no ve las acciones de la otra', async () => {
    await openAction();
    await openAction({ siteId: SITE_B });

    const listed = await actions.list(asSupervisor());

    expect(listed.length).toBeGreaterThan(0);
    expect(listed.every((action) => action.site_id === SITE_A)).toBe(true);
  });

  it('una acción de la otra planta responde como una que no existe', async () => {
    const actionId = await openAction({ siteId: SITE_B });

    await expect(actions.get(asSupervisor(), actionId)).rejects.toMatchObject({
      response: { code: 'action_not_found' },
    });
  });

  it('una transacción sin alcance no ve nada', async () => {
    await openAction();

    const rows = await inScope<{ count: string }>(
      db.app,
      [],
      `SELECT (SELECT count(*) FROM corrective_action)
            + (SELECT count(*) FROM corrective_action_event)
            + (SELECT count(*) FROM corrective_action_evidence)
            + (SELECT count(*) FROM corrective_action_escalation) AS count`,
    );

    expect(Number(one(rows).count)).toBe(0);
  });
});

describe('el escalamiento', () => {
  async function escalationsOf(actionId: string) {
    return inScope<{ level: string; days_overdue: number }>(
      db.app,
      [SITE_A],
      `SELECT level, days_overdue FROM corrective_action_escalation
        WHERE action_id = $1 ORDER BY level`,
      [actionId],
    );
  }

  /**
   * Cuántas notificaciones de este tipo tiene CADA destinatario.
   *
   * Por destinatario y no en total: SITE_A tiene dos supervisores, así que un
   * escalamiento correcto produce dos filas — una por persona— y contar el total
   * confundiría "escaló dos veces" con "avisó a dos personas", que es justo lo que este
   * test tiene que distinguir.
   */
  async function notificationsPerRecipient(actionId: string, kind: string): Promise<number[]> {
    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count FROM notification
        WHERE kind = $1 AND payload->>'action_id' = $2
        GROUP BY user_id`,
      [kind, actionId],
    );

    return rows.map((row) => Number(row.count));
  }

  async function notificationsFor(actionId: string, kind: string): Promise<number> {
    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count FROM notification
        WHERE kind = $1 AND payload->>'action_id' = $2`,
      [kind, actionId],
    );

    return Number(one(rows).count);
  }

  it('a los cuatro días escala al supervisor y a nadie más', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, 4));

    expect((await escalationsOf(actionId)).map((row) => row.level)).toEqual(['supervisor']);
    expect(await notificationsFor(actionId, 'corrective_action_overdue_supervisor')).toBeGreaterThan(
      0,
    );
    expect(await notificationsFor(actionId, 'corrective_action_overdue_management')).toBe(0);
  });

  it('a los ocho días escala también a gerencia', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, 8));

    expect((await escalationsOf(actionId)).map((row) => row.level)).toEqual([
      'management',
      'supervisor',
    ]);
    expect(await notificationsFor(actionId, 'corrective_action_overdue_management')).toBeGreaterThan(
      0,
    );
  });

  /**
   * D10 — LA IDEMPOTENCIA. El cron es diario; sobre una acción vencida hace un mes corre
   * treinta veces y escala una sola vez por nivel, porque el segundo `INSERT` no entra.
   */
  it('treinta corridas diarias escalan una vez por nivel', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    for (let day = 1; day <= 30; day += 1) {
      await escalation.run(daysAfter(action.due_at, day));
    }

    expect(await escalationsOf(actionId)).toHaveLength(2);

    // Cada destinatario, exactamente una por nivel. La planta tiene dos supervisores, así
    // que el total es dos y la propiedad que importa es que ninguno la reciba dos veces.
    const toSupervisors = await notificationsPerRecipient(
      actionId,
      'corrective_action_overdue_supervisor',
    );
    const toManagement = await notificationsPerRecipient(
      actionId,
      'corrective_action_overdue_management',
    );

    expect(toSupervisors.length).toBeGreaterThan(0);
    expect(toSupervisors.every((count) => count === 1)).toBe(true);
    expect(toManagement.length).toBeGreaterThan(0);
    expect(toManagement.every((count) => count === 1)).toBe(true);
  });

  it('una acción cerrada no escala', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    await escalation.run(daysAfter(action.due_at, 10));

    expect(await escalationsOf(actionId)).toHaveLength(0);
  });

  it('una acción dentro del plazo no escala', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, -2));

    expect(await escalationsOf(actionId)).toHaveLength(0);
  });

  it('escalar no agrega ningún evento al stream', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    const before = await eventRows(actionId);

    await escalation.run(daysAfter(action.due_at, 8));

    expect(await eventRows(actionId)).toHaveLength(before.length);
    expect(await stateOf(actionId)).toBe('open');
  });
});

/**
 * La inmutabilidad de las cuatro tablas, en el spec del módulo y no en
 * `immutability.int-spec.ts`: es el mismo lugar donde la etapa 4 puso la de `finding`, y
 * acá están las fixtures que hacen falta para tener una acción con su stream, su
 * evidencia y su escalamiento sin volver a construir medio sistema.
 */
describe('la notificación de asignación', () => {
  async function inboxOf(accountId: string, actionId: string): Promise<number> {
    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count FROM notification
        WHERE user_id = $1 AND kind = 'corrective_action_assigned'
          AND payload->>'action_id' = $2`,
      [accountId, actionId],
    );

    return Number(one(rows).count);
  }

  it('el responsable con cuenta la recibe, con su plazo', async () => {
    const actionId = await openAction();

    expect(await inboxOf(supervisor.accountId, actionId)).toBe(1);

    const rows = await inScope<{ payload: Record<string, unknown> }>(
      db.app,
      [SITE_A],
      `SELECT payload FROM notification
        WHERE kind = 'corrective_action_assigned' AND payload->>'action_id' = $1`,
      [actionId],
    );

    expect(one(rows).payload.due_at).toEqual(expect.any(String));
  });

  /**
   * Persona ≠ Usuario: una persona del roster sin cuenta no tiene bandeja, y la acción
   * se crea igual. La red que cubre ese silencio es el escalamiento a los +3 días, que
   * le llega al supervisor.
   */
  it('un responsable sin cuenta no genera notificación, y la acción se crea igual', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*)::text AS count FROM notification
        WHERE kind = 'corrective_action_assigned' AND payload->>'action_id' = $1`,
      [actionId],
    );

    expect(Number(one(rows).count)).toBe(0);
    expect(await stateOf(actionId)).toBe('open');
  });

  it('la bandeja devuelve juntos los tipos distintos', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, 4));

    const inbox = await stack.notifications.inbox(asSupervisor());
    const kinds = new Set(inbox.map((item) => item.kind));

    // El parseo contra la unión discriminada corre acá: si un `kind` de la base no
    // estuviera en el contrato, esta lectura fallaría en vez de devolver una tarjeta que
    // nadie sabe mostrar (design D11).
    expect(kinds.has('corrective_action_assigned')).toBe(true);
    expect(kinds.has('corrective_action_overdue_supervisor')).toBe(true);
  });
});

describe('el responsable', () => {
  it('una persona dada de baja no puede ser responsable', async () => {
    const retired = await createPerson(db.app, SITE_A);

    await inScope(db.app, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [
      retired,
    ]);

    const { findingId } = await derivedFinding();

    await expect(
      actions.create(asCoordinator(), findingId, {
        assignee_person_id: retired,
        description: 'Install a fixed guard on the infeed of line 3',
        due_at: DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_assignee' } });
  });

  /**
   * La razón por la que la FK es contra `person (id)` a secas y no contra el par con el
   * sitio (0005): transferir a alguien no puede reescribir ni invalidar los registros
   * que lo nombran.
   */
  it('transferir a una persona no toca las acciones que la nombran', async () => {
    const traveller = await createPerson(db.app, SITE_A);
    const { findingId } = await derivedFinding();

    const action = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: traveller,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });

    await inScope(db.app, [SITE_A, SITE_B], 'UPDATE person SET site_id = $2 WHERE id = $1', [
      traveller,
      SITE_B,
    ]);

    const reread = await actions.get(asCoordinator(), action.id);

    expect(reread.site_id).toBe(SITE_A);
    expect(reread.assignee_person_id).toBe(traveller);
  });
});

describe('la inmutabilidad', () => {
  it('el rol de la aplicación no puede correr el plazo después del cierre', async () => {
    const actionId = await openAction();
    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    const error = await inScope(
      db.app,
      [SITE_A],
      `UPDATE corrective_action SET due_at = now() + interval '90 days' WHERE id = $1`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS014');
  });

  it('el rol de la aplicación no puede reescribir un evento', async () => {
    const actionId = await openAction();

    const error = await inScope(
      db.app,
      [SITE_A],
      `UPDATE corrective_action_event SET to_state = 'closed' WHERE action_id = $1`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('42501');
  });

  it('al rol de migración también lo frena el cierre', async () => {
    const actionId = await openAction();
    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    // Con alcance declarado: `FORCE ROW LEVEL SECURITY` aplica también al dueño, así que
    // sin él la sentencia no tocaría ninguna fila y el trigger no diría nada.
    const error = await inScope(
      db.migrator,
      [SITE_A],
      `UPDATE corrective_action SET description = 'nothing to see' WHERE id = $1`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS014');
  });

  it('ninguna de las cuatro tablas admite DELETE', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await awaitingVerification(actionId);
    await escalation.run(daysAfter(action.due_at, 8));

    for (const statement of [
      'DELETE FROM corrective_action WHERE id = $1',
      'DELETE FROM corrective_action_event WHERE action_id = $1',
      'DELETE FROM corrective_action_evidence WHERE action_id = $1',
      'DELETE FROM corrective_action_escalation WHERE action_id = $1',
    ]) {
      const error = await inScope(db.app, [SITE_A], statement, [actionId]).catch(
        (caught: unknown) => caught,
      );

      expect(sqlstate(error)).toBe('42501');
    }
  });

  /**
   * Borrar el evento de cierre sería deshacer una transición sin dejar rastro. Que el
   * estado siga siendo `closed` después del intento es la afirmación entera.
   */
  it('un evento no se puede borrar para deshacer una transición', async () => {
    const actionId = await openAction();

    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    const error = await inScope(
      db.app,
      [SITE_A],
      `DELETE FROM corrective_action_event WHERE action_id = $1 AND to_state = 'closed'`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('42501');
    expect(await stateOf(actionId)).toBe('closed');
  });

  it('un escalamiento no se puede borrar para silenciarlo', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, 4));

    const error = await inScope(
      db.app,
      [SITE_A],
      'DELETE FROM corrective_action_escalation WHERE action_id = $1',
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('42501');

    const rows = await inScope(
      db.app,
      [SITE_A],
      'SELECT id FROM corrective_action_escalation WHERE action_id = $1',
      [actionId],
    );

    expect(rows).toHaveLength(1);
  });

  it('una acción no puede nombrar la planta de otro hallazgo', async () => {
    const { findingId } = await derivedFinding(SITE_B);

    const error = await inScope(
      db.app,
      [SITE_A, SITE_B],
      `INSERT INTO corrective_action
         (site_id, finding_id, assignee_person_id, description, due_at, created_by)
       VALUES ($1, $2, $3, 'Install a fixed guard on the infeed', $4, $5)`,
      [SITE_A, findingId, supervisor.personId, DUE_AT, coordinator.accountId],
    ).catch((caught: unknown) => caught);

    // La FK compuesta contra `finding (id, site_id)`: 23503, y no un 500 sin explicar.
    expect(sqlstate(error)).toBe('23503');
  });

  it('un evento no puede nombrar la planta de otra acción', async () => {
    const actionId = await openAction();

    const error = await inScope(
      db.app,
      [SITE_A, SITE_B],
      `INSERT INTO corrective_action_event
         (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
       VALUES ($1, $2, 1, 'open', 'in_progress', $3, now())`,
      [actionId, SITE_B, coordinator.accountId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('23503');
  });
});

describe('la edición de la asignación vigente (ADR-020)', () => {
  /** Una acción `open` sobre un hallazgo derivado, con el reportante a mano. */
  async function amendable(): Promise<{
    actionId: string;
    findingId: string;
    reporterAccountId: string;
  }> {
    const { findingId, reporterAccountId } = await derivedFinding();
    const action = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: DUE_AT,
    });

    return { actionId: action.id, findingId, reporterAccountId };
  }

  it('una acción recién creada se queda en open, sin segundo evento', async () => {
    const { actionId } = await amendable();

    expect(await stateOf(actionId)).toBe('open');
    expect(await eventRows(actionId)).toHaveLength(1);
  });

  it('el coordinador reemplaza responsable, trabajo y plazo y la acción sigue open', async () => {
    const { actionId } = await amendable();

    const amended = await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: rosterPerson,
      description: 'Install an interlocked guard and update the lockout procedure',
      due_at: LATER_DUE_AT,
    });

    expect(amended.state).toBe('open');
    expect(amended.assignee_person_id).toBe(rosterPerson);
    expect(amended.description).toBe(
      'Install an interlocked guard and update the lockout procedure',
    );
    expect(amended.due_at).toBe(LATER_DUE_AT);
    expect(amended.events).toHaveLength(1);

    const reread = await actions.get(asCoordinator(), actionId);
    expect(reread.assignee_person_id).toBe(rosterPerson);
    expect(reread.due_at).toBe(LATER_DUE_AT);
  });

  it('quien reportó el hallazgo también puede editar', async () => {
    const { actionId, reporterAccountId } = await amendable();

    const amended = await actions.replaceAssignment(
      sessionFor(reporterAccountId, 'jhsc_member', [SITE_A]),
      actionId,
      {
        assignee_person_id: rosterPerson,
        description: 'Install a fixed guard and brief the packaging crew',
        due_at: LATER_DUE_AT,
      },
    );

    expect(amended.description).toBe('Install a fixed guard and brief the packaging crew');
    expect(amended.events).toHaveLength(1);
  });

  it('un supervisor que no reportó el hallazgo no puede editar', async () => {
    const { actionId } = await amendable();

    await expect(
      actions.replaceAssignment(asSupervisor(), actionId, {
        assignee_person_id: rosterPerson,
        description: 'Install a fixed guard on the infeed of line 3 now',
        due_at: LATER_DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });

    expect(await eventRows(actionId)).toHaveLength(1);
  });

  it('dos ediciones sucesivas conservan solamente el último valor', async () => {
    const { actionId } = await amendable();

    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: rosterPerson,
      description: 'First correction of the assignment for this action',
      due_at: LATER_DUE_AT,
    });
    const second = await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: supervisor.personId,
      description: 'Second correction of the assignment for this action',
      due_at: DUE_AT,
    });

    expect(second.description).toBe('Second correction of the assignment for this action');
    expect(second.assignee_person_id).toBe(supervisor.personId);
    expect(second.due_at).toBe(DUE_AT);
    expect(second.events).toHaveLength(1);
  });

  it('acepta editar después de declarar el trabajo hecho', async () => {
    const { actionId } = await amendable();

    await awaitingVerification(actionId);

    const edited = await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: rosterPerson,
      description: 'Reassign the work after it already started here',
      due_at: LATER_DUE_AT,
    });

    expect(edited.state).toBe('awaiting_verification');
    expect(edited.assignee_person_id).toBe(rosterPerson);
  });

  it('un plazo en el pasado se rechaza', async () => {
    const { actionId } = await amendable();

    await expect(
      actions.replaceAssignment(asCoordinator(), actionId, {
        assignee_person_id: rosterPerson,
        description: 'Install a fixed guard on the infeed of line 3 soon',
        due_at: '2000-01-01T00:00:00.000Z',
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_due_at' } });
  });

  it('un responsable de otra planta se rechaza', async () => {
    const { actionId } = await amendable();

    await expect(
      actions.replaceAssignment(asCoordinator(), actionId, {
        assignee_person_id: rosterPersonB,
        description: 'Install a fixed guard on the infeed of line 3 today',
        due_at: LATER_DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_assignee' } });
  });

  it('dos ediciones concurrentes se serializan y dejan un solo valor vigente', async () => {
    const { actionId } = await amendable();

    const results = await Promise.allSettled([
      actions.replaceAssignment(asCoordinator(), actionId, {
        assignee_person_id: rosterPerson,
        description: 'Concurrent correction A of the assignment here',
        due_at: LATER_DUE_AT,
      }),
      actions.replaceAssignment(asCoordinator(), actionId, {
        assignee_person_id: supervisor.personId,
        description: 'Concurrent correction B of the assignment here',
        due_at: DUE_AT,
      }),
    ]);

    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);

    const reread = await actions.get(asCoordinator(), actionId);
    expect([
      'Concurrent correction A of the assignment here',
      'Concurrent correction B of the assignment here',
    ]).toContain(reread.description);
    expect(reread.events).toHaveLength(1);
  });

  it('el motor rechaza por SQL directo un responsable de otra planta', async () => {
    const { actionId } = await amendable();

    const error = await inScope(
      db.app,
      [SITE_A, SITE_B],
      'UPDATE corrective_action SET assignee_person_id = $2 WHERE id = $1',
      [actionId, rosterPersonB],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS003');
  });

  it('retira la notificación anterior y notifica al nuevo responsable con cuenta', async () => {
    const { actionId } = await amendable();

    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: otherSupervisor.personId,
      description: 'Reassign the guard installation to another supervisor',
      due_at: LATER_DUE_AT,
    });

    const rows = await inScope<{ user_id: string; withdrawn_at: Date | null }>(
      db.app,
      [SITE_A],
      `SELECT user_id, withdrawn_at FROM notification
        WHERE kind = 'corrective_action_assigned'
          AND payload->>'action_id' = $1
        ORDER BY created_at`,
      [actionId],
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.user_id === supervisor.accountId)?.withdrawn_at).not.toBeNull();
    expect(rows.find((row) => row.user_id === otherSupervisor.accountId)?.withdrawn_at).toBeNull();
  });

  it('el escalamiento usa el plazo vigente, no el original', async () => {
    const { actionId } = await amendable();

    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: supervisor.personId,
      description: 'Keep the assignee but push the deadline out one month',
      due_at: LATER_DUE_AT,
    });

    // Cuatro días después del plazo ORIGINAL, todavía no vencida contra el vigente.
    await escalation.run(daysAfter(DUE_AT, 4));
    expect(
      await inScope(
        db.app,
        [SITE_A],
        'SELECT id FROM corrective_action_escalation WHERE action_id = $1',
        [actionId],
      ),
    ).toHaveLength(0);

    await escalation.run(daysAfter(LATER_DUE_AT, 4));
    const escalated = await inScope<{ due_at: Date }>(
      db.app,
      [SITE_A],
      'SELECT due_at FROM corrective_action_escalation WHERE action_id = $1 AND level = $2',
      [actionId, 'supervisor'],
    );
    expect(new Date(one(escalated).due_at).toISOString()).toBe(LATER_DUE_AT);
  });

  it('conserva los escalamientos emitidos al cambiar el plazo', async () => {
    const { actionId } = await amendable();

    await escalation.run(daysAfter(DUE_AT, 4));
    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: supervisor.personId,
      description: 'Keep the issued escalation but move the current deadline',
      due_at: LATER_DUE_AT,
    });

    const rows = await inScope<{ due_at: Date }>(
      db.app,
      [SITE_A],
      'SELECT due_at FROM corrective_action_escalation WHERE action_id = $1',
      [actionId],
    );
    expect(rows).toHaveLength(1);
    expect(new Date(one(rows).due_at).toISOString()).toBe(DUE_AT);
  });

  it('aísla la acción por planta y limita las columnas mutables', async () => {
    const { actionId } = await amendable();
    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: rosterPerson,
      description: 'Correction that another site must never see or touch',
      due_at: LATER_DUE_AT,
    });

    const hidden = await inScope(
      db.app,
      [SITE_B],
      'SELECT id FROM corrective_action WHERE id = $1',
      [actionId],
    );
    expect(hidden).toHaveLength(0);

    for (const statement of [
      'UPDATE corrective_action SET created_by = gen_random_uuid() WHERE id = $1',
      'DELETE FROM corrective_action WHERE id = $1',
    ]) {
      const error = await inScope(db.app, [SITE_A], statement, [actionId]).catch(
        (caught: unknown) => caught,
      );
      expect(sqlstate(error)).toBe('42501');
    }

    const ownerError = await inScope(
      db.migrator,
      [SITE_A],
      'UPDATE corrective_action SET created_by = gen_random_uuid() WHERE id = $1',
      [actionId],
    ).catch((caught: unknown) => caught);
    expect(sqlstate(ownerError)).toBe('HS001');
  });

  it('una acción cerrada rechaza la edición por servicio y por SQL directo', async () => {
    const { actionId } = await amendable();
    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    await expect(
      actions.replaceAssignment(asCoordinator(), actionId, {
        assignee_person_id: rosterPerson,
        description: 'The final record cannot be rewritten after closure',
        due_at: LATER_DUE_AT,
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_action_state' } });

    const error = await inScope(
      db.app,
      [SITE_A],
      `UPDATE corrective_action
          SET description = 'The final record cannot be rewritten after closure'
        WHERE id = $1`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS014');
  });

  it('el cierre y una edición concurrente dejan un único snapshot final coherente', async () => {
    const { actionId } = await amendable();
    await awaitingVerification(actionId);

    const results = await Promise.allSettled([
      actions.replaceAssignment(asCoordinator(), actionId, {
        assignee_person_id: rosterPerson,
        description: 'Concurrent replacement visible only if it wins the closure lock',
        due_at: LATER_DUE_AT,
      }),
      actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] }),
    ]);

    expect(results[1]?.status).toBe('fulfilled');
    if (results[0]?.status === 'rejected') {
      expect(results[0].reason).toMatchObject({ response: { code: 'invalid_action_state' } });
    }

    const current = await actions.get(asCoordinator(), actionId);
    const closing = (await auditEvents(SITE_A, 'action.transitioned')).find(
      (row) => row.payload.action_id === actionId && row.payload.to_state === 'closed',
    );

    expect(closing?.payload).toMatchObject({
      assignee_person_id: current.assignee_person_id,
      description: current.description,
    });
    expect(new Date(String(closing?.payload.due_at)).toISOString()).toBe(current.due_at);
  });

  it('las ediciones intermedias no dejan un historial de asignaciones', async () => {
    const { actionId } = await amendable();
    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: rosterPerson,
      description: 'Correction that leaves an audit link of its own',
      due_at: LATER_DUE_AT,
    });

    const links = (await auditEvents(SITE_A, 'action.commitment_amended')).filter(
      (row) => row.payload.action_id === actionId,
    );

    expect(links).toHaveLength(0);
    expect(await chainIsIntact(SITE_A)).toBe(true);
  });
});

describe('la cadena de auditoría', () => {
  it('el recorrido completo deja sus cuatro tipos de eslabón', async () => {
    const before = await chainLength(SITE_A);
    const actionId = await openAction();

    await awaitingVerification(actionId);
    await actions.replaceAssignment(asCoordinator(), actionId, {
      assignee_person_id: rosterPerson,
      description: 'Install an interlocked guard and document the final configuration',
      due_at: LATER_DUE_AT,
    });
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    const created = await auditEvents(SITE_A, 'action.created');
    const transitioned = await auditEvents(SITE_A, 'action.transitioned');
    const evidence = await auditEvents(SITE_A, 'action.evidence_added');

    const mine = created.filter((row) => row.payload.action_id === actionId);
    const myTransitions = transitioned.filter((row) => row.payload.action_id === actionId);

    expect(mine).toHaveLength(1);
    expect(one(mine).payload.due_at).toBeUndefined();

    expect(myTransitions.map((row) => row.payload.to_state)).toEqual([
      'open',
      'in_progress',
      'awaiting_verification',
      'closed',
    ]);

    // El eslabón del cierre nombra al VERIFICADOR, nunca al ejecutor.
    expect(myTransitions[3]?.payload.actor_user_id).toBe(coordinator.accountId);
    expect(myTransitions[3]?.payload).toMatchObject({
      assignee_person_id: rosterPerson,
      description: 'Install an interlocked guard and document the final configuration',
    });
    expect(new Date(String(myTransitions[3]?.payload.due_at)).toISOString()).toBe(LATER_DUE_AT);

    expect(evidence.filter((row) => row.payload.action_id === actionId)).toHaveLength(1);

    expect(await chainLength(SITE_A)).toBeGreaterThan(before);
    expect(await chainIsIntact(SITE_A)).toBe(true);
  });

  it('una transición rechazada no deja eslabón', async () => {
    const actionId = await openAction();
    const before = await chainLength(SITE_A);

    await expect(
      actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] }),
    ).rejects.toBeDefined();

    expect(await chainLength(SITE_A)).toBe(before);
    expect(await chainIsIntact(SITE_A)).toBe(true);
  });

  it('el escalamiento deja eslabón sin autor', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, 8));

    const escalated = (await auditEvents(SITE_A, 'action.escalated')).filter(
      (row) => row.payload.action_id === actionId,
    );

    expect(escalated).toHaveLength(2);
    expect(escalated.every((row) => row.actor_user_id === null)).toBe(true);
    expect(escalated.map((row) => row.payload.level).sort()).toEqual(['management', 'supervisor']);
    expect(await chainIsIntact(SITE_A)).toBe(true);
  });

  it('corridas repetidas no agregan eslabones', async () => {
    const actionId = await openAction();
    const action = await actions.get(asCoordinator(), actionId);

    await escalation.run(daysAfter(action.due_at, 8));

    const after = await chainLength(SITE_A);

    for (let day = 9; day <= 18; day += 1) {
      await escalation.run(daysAfter(action.due_at, day));
    }

    expect(await chainLength(SITE_A)).toBe(after);
    expect(await chainIsIntact(SITE_A)).toBe(true);
  });
});
