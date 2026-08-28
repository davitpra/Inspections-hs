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
 *   5. Declarar el trabajo hecho sin evidencia no llega a commitear.
 *   6. El plazo, congelado, sobrevive a una reclasificación.
 *   7. Treinta corridas del cron escalan una vez por nivel.
 */

const SITE_A = 'ac700000-0000-4000-8000-000000000001';
const SITE_B = 'ac700000-0000-4000-8000-000000000002';

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
let otherSupervisor: { accountId: string };
let manager: { accountId: string };
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

/**
 * Un hallazgo derivado de un envío real, clasificado con la severidad pedida.
 *
 * Se llega hasta acá por el camino de verdad —envío → derivación → clasificación— y no
 * insertando filas: lo que este spec prueba cuelga de un hallazgo, y un hallazgo
 * fabricado a mano podría no parecerse al que produce la etapa 4.
 */
async function classifiedFinding(
  severity: string,
  siteId = SITE_A,
): Promise<{ findingId: string }> {
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

  await findings.classify(asCoordinator(), findingId, {
    probability: 'possible',
    severity: severity as 'major',
    control_level: 'engineering',
  });

  return { findingId };
}

/** Una acción abierta sobre un hallazgo nuevo, con el responsable pedido. */
async function openAction(
  options: { severity?: string; assignee?: string; siteId?: string } = {},
): Promise<string> {
  const siteId = options.siteId ?? SITE_A;
  const { findingId } = await classifiedFinding(options.severity ?? 'major', siteId);

  const action = await actions.create(asCoordinator(), findingId, {
    assignee_person_id:
      options.assignee ?? (siteId === SITE_B ? rosterPersonB : supervisor.personId),
    description: 'Install a fixed guard on the infeed of line 3',
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
    classification: {
      probability: 'possible',
      severity: 'moderate',
      control_level: 'engineering',
    },
  });
  const action = await actions.create(asCoordinator(), finding.id, {
    assignee_person_id: supervisor.personId,
    description: 'Replace the damaged barrier at the loading dock',
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

/** Lleva una acción hasta `awaiting_verification`, ejecutada por el supervisor. */
async function awaitingVerification(actionId: string): Promise<void> {
  await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
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
    expect(found?.severity).toBe('major');
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

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 2, 'open', 'in_progress', $3, now())`,
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
         VALUES ($1, $2, 99, 'open', 'in_progress', $3, now())`,
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

    const results = await Promise.allSettled([
      actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] }),
      actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const rejected = results.find((result) => result.status === 'rejected');

    expect(rejected).toBeDefined();
    expect(await eventRows(actionId)).toHaveLength(2);
    expect(await stateOf(actionId)).toBe('in_progress');
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
   * El caso que D6 explica: el coordinador ejecutó EN NOMBRE de una persona sin cuenta.
   * Si la regla comparara contra `assignee_person_id`, ese coordinador podría
   * verificarse a sí mismo — que es exactamente lo que R3 prohíbe.
   */
  it('el coordinador que ejecutó en nombre de otro tampoco puede verificar', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await actions.transition(asCoordinator(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asCoordinator(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    await expect(
      actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'verifier_is_executor' } });

    const closed = await actions.transition(asManager(), actionId, { to: 'closed', evidence: [] });

    expect(closed.state).toBe('closed');
  });
});

describe('la evidencia', () => {
  it('declarar el trabajo hecho sin evidencia se rechaza', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });

    await expect(
      actions.transition(asSupervisor(), actionId, {
        to: 'awaiting_verification',
        evidence: [{ kind: 'before', object_key: evidenceKey(actionId) }],
      }),
    ).rejects.toBeDefined();

    expect(await stateOf(actionId)).toBe('in_progress');
  });

  /**
   * La barrera que no depende del servicio: un `INSERT` directo del evento, sin
   * evidencia, no llega a commitear. Es la restricción diferida `HS006`.
   */
  it('un evento de completado sin evidencia no commitea (HS006)', async () => {
    const actionId = await openAction();

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action_event
           (action_id, site_id, position, from_state, to_state, actor_user_id, occurred_at)
         VALUES ($1, $2, 2, 'in_progress', 'awaiting_verification', $3, now())`,
        [actionId, SITE_A, supervisor.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS006');

    expect(await stateOf(actionId)).toBe('in_progress');
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
  it('un hallazgo sin clasificar no puede recibir acciones', async () => {
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

    await expect(
      actions.create(asCoordinator(), one(rows).id, {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
      }),
    ).rejects.toMatchObject({ response: { code: 'finding_not_classified' } });

    const created = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*)::text AS count FROM corrective_action WHERE finding_id = $1',
      [one(rows).id],
    );

    expect(Number(one(created).count)).toBe(0);
  });

  it('el plazo sale de la severidad y no del caller', async () => {
    const { findingId } = await classifiedFinding('catastrophic');
    const before = Date.now();

    const action = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Stop the line until the guard is fitted',
    });

    const dueAt = new Date(action.due_at).getTime();

    expect(action.severity).toBe('catastrophic');
    expect(dueAt - before).toBeGreaterThan(2.9 * 24 * 60 * 60 * 1000);
    expect(dueAt - before).toBeLessThan(3.1 * 24 * 60 * 60 * 1000);
  });

  /**
   * D5 — el plazo se congela. Reclasificar el hallazgo NO mueve el vencimiento de una
   * acción ya abierta, y esa es la propiedad que hace que el registro pueda decir qué
   * se prometió el día que se prometió.
   */
  it('reclasificar el hallazgo no mueve el plazo de una acción abierta', async () => {
    const { findingId } = await classifiedFinding('moderate');

    const action = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: supervisor.personId,
      description: 'Install a fixed guard on the infeed of line 3',
    });

    await findings.classify(asCoordinator(), findingId, {
      probability: 'almost_certain',
      severity: 'catastrophic',
      control_level: 'engineering',
      reason: 'a second visit showed the guard is removed every shift',
    });

    const reread = await actions.get(asCoordinator(), action.id);

    expect(reread.due_at).toBe(action.due_at);
    expect(reread.severity).toBe('moderate');
  });

  it('varias acciones sobre el mismo hallazgo, cada una con su responsable', async () => {
    const { findingId } = await classifiedFinding('major');

    for (const assignee of [supervisor.personId, rosterPerson]) {
      await actions.create(asCoordinator(), findingId, {
        assignee_person_id: assignee,
        description: 'Install a fixed guard on the infeed of line 3',
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
    const { findingId } = await classifiedFinding('major');

    await expect(
      actions.create(asCoordinator(), findingId, {
        assignee_person_id: rosterPersonB,
        description: 'Install a fixed guard on the infeed of line 3',
      }),
    ).rejects.toMatchObject({ response: { code: 'invalid_assignee' } });
  });

  it('una acción sin ningún evento no commitea (HS007)', async () => {
    const { findingId } = await classifiedFinding('major');

    await expect(
      inScope(
        db.app,
        [SITE_A],
        `INSERT INTO corrective_action
           (site_id, finding_id, assignee_person_id, description, severity, due_at, created_by)
         VALUES ($1, $2, $3, 'Install a fixed guard on the infeed', 'major', now(), $4)`,
        [SITE_A, findingId, supervisor.personId, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error: unknown) => sqlstate(error) === 'HS007');
  });

  it('la remediación compartida agrupa y no cambia nada', async () => {
    const groupId = randomUUID();
    const created = [];

    for (const severity of ['catastrophic', 'negligible']) {
      const { findingId } = await classifiedFinding(severity);

      created.push(
        await actions.create(asCoordinator(), findingId, {
          assignee_person_id: supervisor.personId,
          description: 'Fit guards across every packaging line',
          remediation_group_id: groupId,
        }),
      );
    }

    // Cada una con SU plazo, derivado de SU severidad: el grupo no los uniformó.
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
    const { findingId } = await classifiedFinding('major');

    await expect(
      actions.create(asSupervisor(), findingId, {
        assignee_person_id: supervisor.personId,
        description: 'Install a fixed guard on the infeed of line 3',
      }),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('un supervisor que no es el responsable no puede avanzarla', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    await expect(
      actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'forbidden' } });
  });

  it('el coordinador avanza en nombre de una persona sin cuenta', async () => {
    const actionId = await openAction({ assignee: rosterPerson });

    const action = await actions.transition(asCoordinator(), actionId, {
      to: 'in_progress',
      evidence: [],
    });

    expect(action.state).toBe('in_progress');
    expect(action.events[1]?.actor_user_id).toBe(coordinator.accountId);
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

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });

    const before = await eventRows(actionId);

    await escalation.run(daysAfter(action.due_at, 8));

    expect(await eventRows(actionId)).toHaveLength(before.length);
    expect(await stateOf(actionId)).toBe('in_progress');
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
    expect(one(rows).payload.severity).toBe('major');
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

    const { findingId } = await classifiedFinding('major');

    await expect(
      actions.create(asCoordinator(), findingId, {
        assignee_person_id: retired,
        description: 'Install a fixed guard on the infeed of line 3',
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
    const { findingId } = await classifiedFinding('major');

    const action = await actions.create(asCoordinator(), findingId, {
      assignee_person_id: traveller,
      description: 'Install a fixed guard on the infeed of line 3',
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
  it('el rol de la aplicación no puede correr un plazo', async () => {
    const actionId = await openAction();

    const error = await inScope(
      db.app,
      [SITE_A],
      `UPDATE corrective_action SET due_at = now() + interval '90 days' WHERE id = $1`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('42501');
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

  it('al rol de migración lo frena el trigger, no el privilegio', async () => {
    const actionId = await openAction();

    // Con alcance declarado: `FORCE ROW LEVEL SECURITY` aplica también al dueño, así que
    // sin él la sentencia no tocaría ninguna fila y el trigger no diría nada.
    const error = await inScope(
      db.migrator,
      [SITE_A],
      `UPDATE corrective_action SET description = 'nothing to see' WHERE id = $1`,
      [actionId],
    ).catch((caught: unknown) => caught);

    expect(sqlstate(error)).toBe('HS001');
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
    const { findingId } = await classifiedFinding('major', SITE_B);

    const error = await inScope(
      db.app,
      [SITE_A, SITE_B],
      `INSERT INTO corrective_action
         (site_id, finding_id, assignee_person_id, description, severity, due_at, created_by)
       VALUES ($1, $2, $3, 'Install a fixed guard on the infeed', 'major', now(), $4)`,
      [SITE_A, findingId, supervisor.personId, coordinator.accountId],
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

describe('la cadena de auditoría', () => {
  it('el recorrido completo deja sus cuatro tipos de eslabón', async () => {
    const before = await chainLength(SITE_A);
    const actionId = await openAction();

    await awaitingVerification(actionId);
    await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });

    const created = await auditEvents(SITE_A, 'action.created');
    const transitioned = await auditEvents(SITE_A, 'action.transitioned');
    const evidence = await auditEvents(SITE_A, 'action.evidence_added');

    const mine = created.filter((row) => row.payload.action_id === actionId);
    const myTransitions = transitioned.filter((row) => row.payload.action_id === actionId);

    expect(mine).toHaveLength(1);
    expect(one(mine).payload.severity).toBe('major');
    expect(one(mine).payload.due_at).toEqual(expect.any(String));

    expect(myTransitions.map((row) => row.payload.to_state)).toEqual([
      'open',
      'in_progress',
      'awaiting_verification',
      'closed',
    ]);

    // El eslabón del cierre nombra al VERIFICADOR, nunca al ejecutor.
    expect(myTransitions[3]?.payload.actor_user_id).toBe(coordinator.accountId);

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
