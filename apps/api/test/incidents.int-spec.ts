import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BODY_PARTS,
  INCIDENT_CLASSIFICATIONS,
  INCIDENT_STATES,
  INVESTIGATION_METHODS,
  ON_SITE_TREATMENTS,
  incidentTransitionFor,
  type IncidentClassification,
  type IncidentState,
  type ReportIncidentRequest,
} from '@hs/contracts';

import { ActionsService } from '../src/actions/actions.service';
import { IncidentsService } from '../src/incidents/incidents.service';
import { createLocation, registerSite } from './helpers/catalog';
import { createAccount, createPerson } from './helpers/identity';
import {
  inScope,
  inSession,
  one,
  sqlstate,
  startTestDatabase,
  type TestDatabase,
} from './helpers/postgres';
import { createSchedulingStack, type SchedulingStack } from './helpers/scheduling';

/**
 * Requisitos §7 etapa 6 — El incidente en tercera persona y R4.
 *
 * Lo que estos tests prueban no es que se guarden filas. Es que las propiedades que
 * hacen que R4 signifique algo se cumplan aunque el cliente se porte mal y aunque
 * alguien escriba SQL a mano:
 *
 *   1. El estado sale de los eventos y no de ninguna columna.
 *   2. Las listas cerradas de `@hs/contracts` y las de 0012 son la misma lista.
 *   3. Solo las cinco transiciones existen, por el endpoint y por `INSERT` directo.
 *   4. Un incidente no se cierra con acciones abiertas, ni siquiera insertando a mano.
 *   5. Tres clasificaciones no se cierran sin investigar, y ninguna sin causa raíz.
 *   6. Un supervisor no ve el incidente de otro, ni por endpoint ni por `SELECT *`.
 *   7. Sin rol declarado no se ve ningún incidente: el modo de falla es cerrado.
 *   8. Los relojes se calculan y no existen como columna.
 *   9. La auditoría no lleva narrativa ni nombre.
 */

const SITE_A = '1c500000-0000-4000-8000-000000000001';
const SITE_B = '1c500000-0000-4000-8000-000000000002';

let db: TestDatabase;
let stack: SchedulingStack;
let incidents: IncidentsService;
let actions: ActionsService;

let locationA: string;
let locationB: string;

let coordinator: { accountId: string; personId: string };
let supervisor: { accountId: string; personId: string };
let otherSupervisor: { accountId: string; personId: string };
let manager: { accountId: string; personId: string };
let jhsc: { accountId: string; personId: string };
let supervisorB: { accountId: string; personId: string };

/** Personas del roster sin cuenta: el caso normal con 200 personas y 20 usuarios. */
let subject: string;
let witness: string;
let subjectB: string;

const sessionFor = (accountId: string, role: string, siteIds: string[]) => ({
  userId: accountId,
  role,
  siteIds,
});

const asCoordinator = () => sessionFor(coordinator.accountId, 'hs_coordinator', [SITE_A, SITE_B]);
const asSupervisor = () => sessionFor(supervisor.accountId, 'supervisor', [SITE_A]);
const asOtherSupervisor = () => sessionFor(otherSupervisor.accountId, 'supervisor', [SITE_A]);
const asManager = () => sessionFor(manager.accountId, 'management', [SITE_A]);
const asJhsc = () => sessionFor(jhsc.accountId, 'jhsc_member', [SITE_A]);
const asSupervisorB = () => sessionFor(supervisorB.accountId, 'supervisor', [SITE_B]);

function payload(overrides: Partial<ReportIncidentRequest> = {}): ReportIncidentRequest {
  return {
    subject_person_id: subject,
    classification: 'health_care',
    occurred_at: '2026-03-02T08:00:00-05:00',
    location_id: locationA,
    task_performed: 'Moving pallets with the forklift',
    equipment_involved: 'Forklift #4',
    what_happened: 'The load shifted and struck the worker on the hand',
    body_part: 'hand_or_finger',
    on_site_treatment: 'first_aid_on_site',
    immediate_action: 'Area cordoned off and the forklift tagged out',
    narrative_language: 'en',
    witness_person_ids: [],
    ...overrides,
  };
}

async function report(
  overrides: Partial<ReportIncidentRequest> = {},
  session = asSupervisor(),
): Promise<string> {
  const incident = await incidents.report(session, payload(overrides));

  return incident.id;
}

/** Lleva un incidente a `under_investigation` con una causa raíz ya registrada. */
async function investigated(
  classification: IncidentClassification = 'critical_injury',
): Promise<string> {
  const incidentId = await report({ classification });

  await incidents.transition(asCoordinator(), incidentId, {
    to: 'under_investigation',
    method: 'five_whys',
  });

  await incidents.recordCause(asCoordinator(), incidentId, {
    statement: 'The guard interlock had been bypassed to speed up changeovers',
    is_root: true,
  });

  return incidentId;
}

async function stateOf(incidentId: string, siteIds = [SITE_A]): Promise<string> {
  const rows = await inSession<{ to_state: string }>(
    db.app,
    { siteIds, userId: coordinator.accountId, role: 'hs_coordinator' },
    `SELECT DISTINCT ON (e.incident_id) e.to_state
       FROM incident_event e
      WHERE e.incident_id = $1
      ORDER BY e.incident_id, e.position DESC`,
    [incidentId],
  );

  return one(rows).to_state;
}

/** Una acción correctiva abierta sobre la investigación de un incidente. */
async function openActionOn(incidentId: string): Promise<string> {
  const rows = await inSession<{ id: string }>(
    db.app,
    { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
    'SELECT id FROM investigation WHERE incident_id = $1',
    [incidentId],
  );

  const action = await actions.createForInvestigation(asCoordinator(), one(rows).id, {
    assignee_person_id: supervisor.personId,
    description: 'Replace the bypassed interlock and retrain the changeover crew',
    severity: 'major',
  });

  return action.id;
}

const evidenceKey = (actionId: string) => `${SITE_A}/actions/${actionId}/${randomUUID()}`;

/** Recorre una acción hasta `closed`, ejecutada por el supervisor y cerrada por otro. */
async function closeAction(actionId: string): Promise<void> {
  await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
  await actions.transition(asSupervisor(), actionId, {
    to: 'awaiting_verification',
    evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
  });
  await actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] });
}

beforeAll(async () => {
  db = await startTestDatabase();
  stack = createSchedulingStack(db.appUrl);
  incidents = new IncidentsService(stack.db);
  actions = new ActionsService(stack.db);

  await registerSite(db.migrator, SITE_A, 'inc-a');
  await registerSite(db.migrator, SITE_B, 'inc-b');

  locationA = await createLocation(db.app, SITE_A, 'line-3', 'Packaging line 3');
  locationB = await createLocation(db.app, SITE_B, 'line-3', 'Packaging line 3');

  coordinator = await createAccount(db.app, {
    siteIds: [SITE_A, SITE_B],
    role: 'hs_coordinator',
  });
  supervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
  otherSupervisor = await createAccount(db.app, { siteIds: [SITE_A], role: 'supervisor' });
  manager = await createAccount(db.app, { siteIds: [SITE_A], role: 'management' });
  jhsc = await createAccount(db.app, { siteIds: [SITE_A], role: 'jhsc_member' });
  supervisorB = await createAccount(db.app, { siteIds: [SITE_B], role: 'supervisor' });

  subject = await createPerson(db.app, SITE_A);
  witness = await createPerson(db.app, SITE_A);
  subjectB = await createPerson(db.app, SITE_B);
}, 180_000);

afterAll(async () => {
  await stack.stop();
  await db.stop();
});

// ---------------------------------------------------------------------------

describe('el recorrido completo de R4', () => {
  it('reporta en tercera persona, investiga, cierra las acciones y cierra el incidente', async () => {
    const incidentId = await report({ classification: 'critical_injury' });

    expect(await stateOf(incidentId)).toBe('reported');

    await incidents.transition(asCoordinator(), incidentId, {
      to: 'under_investigation',
      method: 'five_whys',
      sequence_of_events: 'Changeover started at 07:40; the interlock was bypassed at 07:52',
    });

    expect(await stateOf(incidentId)).toBe('under_investigation');

    await incidents.recordCause(asCoordinator(), incidentId, {
      statement: 'The guard interlock had been bypassed to speed up changeovers',
      is_root: true,
    });

    const actionId = await openActionOn(incidentId);
    await closeAction(actionId);

    const closed = await incidents.transition(asCoordinator(), incidentId, {
      to: 'closed',
    });

    expect(closed.state).toBe('closed');
    expect(closed.investigation?.method).toBe('five_whys');
    expect(closed.investigation?.causes).toHaveLength(1);
    expect(closed.events.map((event) => event.to_state)).toEqual([
      'reported',
      'under_investigation',
      'closed',
    ]);
  });

  it('el sujeto es una persona del roster sin cuenta, y el reportante es una cuenta', async () => {
    const incident = await incidents.report(asSupervisor(), payload());

    expect(incident.subject_person_id).toBe(subject);
    expect(incident.reported_by).toBe(supervisor.accountId);

    const accounts = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      'SELECT count(*) FROM app_user WHERE person_id = $1',
      [subject],
    );

    expect(one(accounts).count).toBe('0');
  });

  it('los testigos son referencias a Persona y no ganan cuenta ni notificación', async () => {
    const incident = await incidents.report(
      asSupervisor(),
      payload({ witness_person_ids: [witness] }),
    );

    expect(incident.witnesses).toHaveLength(1);
    expect(incident.witnesses[0]?.id).toBe(witness);
    expect(incident.witnesses[0]?.employee_number).toBeTruthy();

    const notifications = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*) FROM notification n
        JOIN app_user u ON u.id = n.user_id
       WHERE u.person_id = $1`,
      [witness],
    );

    expect(one(notifications).count).toBe('0');
  });
});

// ---------------------------------------------------------------------------

describe('las listas cerradas, escritas dos veces', () => {
  async function checkValues(table: string, column: string): Promise<string[]> {
    const rows = await inScope<{ definition: string }>(
      db.migrator,
      [],
      `SELECT pg_get_constraintdef(c.oid) AS definition
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE t.relname = $1
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) LIKE '%' || $2 || '%'`,
      [table, column],
    );

    const definition = rows.map((row) => row.definition).join(' ');

    return [...definition.matchAll(/'([a-z0-9_]+)'::text/g)].map((match) => match[1] as string);
  }

  it('las cinco clasificaciones de `@hs/contracts` son las del CHECK de 0012', async () => {
    const inSql = new Set(await checkValues('incident', 'classification'));

    expect([...inSql].sort()).toEqual([...INCIDENT_CLASSIFICATIONS].sort());
  });

  it('`near_miss` no está en ninguno de los dos lados', async () => {
    const inSql = await checkValues('incident', 'classification');

    expect(inSql).not.toContain('near_miss');
    expect(INCIDENT_CLASSIFICATIONS as readonly string[]).not.toContain('near_miss');
  });

  it('los tres estados coinciden', async () => {
    const inSql = new Set(await checkValues('incident_event', 'to_state'));

    expect([...inSql].sort()).toEqual([...INCIDENT_STATES].sort());
  });

  it('las partes del cuerpo y los tratamientos coinciden', async () => {
    expect(new Set(await checkValues('incident', 'body_part'))).toEqual(new Set(BODY_PARTS));
    expect(new Set(await checkValues('incident', 'on_site_treatment'))).toEqual(
      new Set(ON_SITE_TREATMENTS),
    );
  });

  it('los dos métodos de investigación coinciden', async () => {
    expect(new Set(await checkValues('investigation', 'method'))).toEqual(
      new Set(INVESTIGATION_METHODS),
    );
  });

  it('un `near_miss` insertado directo choca contra el CHECK', async () => {
    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
        `INSERT INTO incident
           (site_id, form_version, classification, subject_person_id, reported_by,
            occurred_at, location_id, task_performed, equipment_involved, what_happened,
            body_part, on_site_treatment, immediate_action, narrative_language)
         VALUES ($1, 1, 'near_miss', $2, $3, now(), $4, 'task', 'equipment',
                 'what happened', 'hand_or_finger', 'none', 'immediate', 'en')`,
        [SITE_A, subject, supervisor.accountId, locationA],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23514');
  });
});

// ---------------------------------------------------------------------------

describe('la máquina de estados, por los dos caminos', () => {
  it('las dos implementaciones de la tabla coinciden en todos los pares', async () => {
    const froms: ReadonlyArray<IncidentState | null> = [null, ...INCIDENT_STATES];

    for (const from of froms) {
      for (const to of INCIDENT_STATES) {
        const inContracts = incidentTransitionFor(from, to) !== undefined;

        const rows = await inScope<{ allowed: boolean }>(
          db.migrator,
          [],
          `SELECT EXISTS (
             SELECT 1
               FROM (VALUES
                 (NULL,                  'reported'),
                 ('reported',            'under_investigation'),
                 ('reported',            'closed'),
                 ('under_investigation', 'closed'),
                 ('closed',              'under_investigation')
               ) AS allowed(from_state, to_state)
              WHERE allowed.from_state IS NOT DISTINCT FROM $1::text
                AND allowed.to_state = $2::text) AS allowed`,
          [from, to],
        );

        expect(one(rows).allowed).toBe(inContracts);
      }
    }
  });

  it('un incidente reportado no puede saltar a reportado otra vez', async () => {
    const incidentId = await report();

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'reported' }),
    ).rejects.toMatchObject({ response: { code: 'invalid_transition' } });
  });

  it('un evento cuyo `from_state` no es el vigente lo rechaza el motor', async () => {
    const incidentId = await investigated();

    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
        `INSERT INTO incident_event
           (incident_id, site_id, position, from_state, to_state, actor_user_id)
         VALUES ($1, $2, 2, 'reported', 'closed', $3)`,
        [incidentId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS008');
  });

  it('solo el coordinador investiga, cierra y reabre', async () => {
    const incidentId = await report();

    // Quien VE el incidente y no puede moverlo recibe `forbidden`.
    for (const session of [asSupervisor(), asManager()]) {
      await expect(
        incidents.transition(session, incidentId, {
          to: 'under_investigation',
          method: 'five_whys',
        }),
      ).rejects.toMatchObject({ response: { code: 'forbidden' } });
    }

    // El miembro del JHSC ni siquiera lo ve, así que recibe "no existe" — y esa
    // diferencia es deseable: un `forbidden` le confirmaría que hay un incidente ahí.
    await expect(
      incidents.transition(asJhsc(), incidentId, {
        to: 'under_investigation',
        method: 'five_whys',
      }),
    ).rejects.toMatchObject({ response: { code: 'incident_not_found' } });

    await expect(
      incidents.transition(asCoordinator(), incidentId, {
        to: 'under_investigation',
        method: 'five_whys',
      }),
    ).resolves.toMatchObject({ state: 'under_investigation' });
  });

  it('reabrir es un evento nuevo y el evento de cierre sigue ahí', async () => {
    const incidentId = await investigated();
    await incidents.transition(asCoordinator(), incidentId, { to: 'closed' });

    const reopened = await incidents.transition(asCoordinator(), incidentId, {
      to: 'under_investigation',
      reason: 'A second worker reported the same interlock bypassed on line 5',
    });

    expect(reopened.state).toBe('under_investigation');
    expect(reopened.events.map((event) => event.to_state)).toEqual([
      'reported',
      'under_investigation',
      'closed',
      'under_investigation',
    ]);
    expect(reopened.events[3]?.reason).toContain('interlock');
  });

  it('reabrir sin motivo se rechaza', async () => {
    const incidentId = await investigated();
    await incidents.transition(asCoordinator(), incidentId, { to: 'closed' });

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'under_investigation' }),
    ).rejects.toMatchObject({ response: { code: 'invalid_transition' } });
  });

  it('dos transiciones concurrentes no bifurcan el stream', async () => {
    const incidentId = await report();

    const results = await Promise.allSettled([
      incidents.transition(asCoordinator(), incidentId, {
        to: 'under_investigation',
        method: 'five_whys',
      }),
      incidents.transition(asCoordinator(), incidentId, {
        to: 'under_investigation',
        method: 'cause_tree',
      }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const events = await inSession<{ count: string }>(
      db.app,
      { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
      'SELECT count(*) FROM incident_event WHERE incident_id = $1',
      [incidentId],
    );

    expect(one(events).count).toBe('2');
  });
});

// ---------------------------------------------------------------------------

describe('la guarda que da sentido a la máquina: no se cierra con acciones abiertas', () => {
  it('una acción `open` bloquea el cierre', async () => {
    const incidentId = await investigated();
    await openActionOn(incidentId);

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).rejects.toMatchObject({ response: { code: 'incident_has_open_actions' } });

    expect(await stateOf(incidentId)).toBe('under_investigation');
  });

  it('una acción esperando verificación también lo bloquea', async () => {
    const incidentId = await investigated();
    const actionId = await openActionOn(incidentId);

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asSupervisor(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).rejects.toMatchObject({ response: { code: 'incident_has_open_actions' } });
  });

  it('con todas cerradas, el incidente cierra', async () => {
    const incidentId = await investigated();

    for (const _ of [1, 2, 3]) {
      await closeAction(await openActionOn(incidentId));
    }

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).resolves.toMatchObject({ state: 'closed' });
  });

  it('un incidente sin acciones cierra', async () => {
    const incidentId = await investigated();

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).resolves.toMatchObject({ state: 'closed' });
  });

  it('la guarda aguanta un INSERT directo del evento de cierre', async () => {
    const incidentId = await investigated();
    await openActionOn(incidentId);

    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
        `INSERT INTO incident_event
           (incident_id, site_id, position, from_state, to_state, actor_user_id)
         VALUES ($1, $2, 2, 'under_investigation', 'closed', $3)`,
        [incidentId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS009');
  });

  it('una acción abierta después de reabrir bloquea el segundo cierre', async () => {
    const incidentId = await investigated();
    await incidents.transition(asCoordinator(), incidentId, { to: 'closed' });
    await incidents.transition(asCoordinator(), incidentId, {
      to: 'under_investigation',
      reason: 'The same interlock was found bypassed again two weeks later',
    });

    await openActionOn(incidentId);

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).rejects.toMatchObject({ response: { code: 'incident_has_open_actions' } });
  });
});

// ---------------------------------------------------------------------------

describe('la investigación obligatoria y la causa raíz', () => {
  for (const classification of [
    'critical_injury',
    'lost_time_or_modified_work',
    'occupational_illness',
  ] as const) {
    it(`${classification} no se cierra sin investigar`, async () => {
      const incidentId = await report({ classification });

      await expect(
        incidents.transition(asCoordinator(), incidentId, {
          to: 'closed',
          reason: 'The worker returned to full duties the same afternoon',
        }),
      ).rejects.toMatchObject({ response: { code: 'investigation_required' } });
    });
  }

  it('la guarda de investigación obligatoria aguanta un INSERT directo', async () => {
    const incidentId = await report({ classification: 'critical_injury' });

    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
        `INSERT INTO incident_event
           (incident_id, site_id, position, from_state, to_state, actor_user_id, reason)
         VALUES ($1, $2, 1, 'reported', 'closed', $3, 'closing without investigating')`,
        [incidentId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS010');
  });

  for (const classification of ['first_aid', 'health_care'] as const) {
    it(`${classification} cierra con motivo, sin investigar`, async () => {
      const incidentId = await report({ classification });

      const closed = await incidents.transition(asCoordinator(), incidentId, {
        to: 'closed',
        reason: 'Minor cut treated on site; no further action needed',
      });

      expect(closed.state).toBe('closed');
      expect(closed.investigation).toBeNull();
    });
  }

  it('el cierre directo sin motivo se rechaza', async () => {
    const incidentId = await report({ classification: 'first_aid' });

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).rejects.toMatchObject({ response: { code: 'invalid_transition' } });
  });

  it('cerrar una investigación sin causa raíz se rechaza', async () => {
    const incidentId = await report({ classification: 'critical_injury' });

    await incidents.transition(asCoordinator(), incidentId, {
      to: 'under_investigation',
      method: 'cause_tree',
    });

    await incidents.recordCause(asCoordinator(), incidentId, {
      statement: 'The changeover took longer than the shift allowed for',
      is_root: false,
    });

    await expect(
      incidents.transition(asCoordinator(), incidentId, { to: 'closed' }),
    ).rejects.toMatchObject({ response: { code: 'root_cause_required' } });
  });

  it('una segunda investigación del mismo incidente se rechaza', async () => {
    const incidentId = await investigated();

    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
        `INSERT INTO investigation (incident_id, site_id, method, opened_by)
         VALUES ($1, $2, 'cause_tree', $3)`,
        [incidentId, SITE_A, coordinator.accountId],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '23505');
  });

  it('corregir una causa es agregar otra: no se puede actualizar ni borrar', async () => {
    const incidentId = await investigated();

    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
        `UPDATE investigation_cause SET statement = 'another cause'`,
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '42501');

    const after = await incidents.get(asCoordinator(), incidentId);

    expect(after.investigation?.causes[0]?.statement).toContain('interlock');
  });
});

// ---------------------------------------------------------------------------

describe('las restricciones diferidas', () => {
  it('un incidente sin evento de reporte no llega a existir', async () => {
    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
        `INSERT INTO incident
           (site_id, form_version, classification, subject_person_id, reported_by,
            occurred_at, location_id, task_performed, equipment_involved, what_happened,
            body_part, on_site_treatment, immediate_action, narrative_language)
         VALUES ($1, 1, 'first_aid', $2, $3, now(), $4, 'task', 'equipment',
                 'what happened', 'hand_or_finger', 'none', 'immediate', 'en')`,
        [SITE_A, subject, supervisor.accountId, locationA],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS012');
  });
});

// ---------------------------------------------------------------------------

describe('la inmutabilidad de las cinco tablas', () => {
  const TABLES = [
    'incident',
    'incident_event',
    'incident_witness',
    'investigation',
    'investigation_cause',
  ];

  it('el rol de aplicación no puede reescribir una narrativa', async () => {
    await report();

    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
        `UPDATE incident SET what_happened = 'something else'`,
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '42501');
  });

  it('el rol de aplicación no puede cambiar una clasificación', async () => {
    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
        `UPDATE incident SET classification = 'first_aid'`,
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '42501');
  });

  /**
   * CON SITIO, CUENTA Y ROL DECLARADOS, y no es un detalle del test.
   *
   * Los triggers de `hs_make_immutable` son POR FILA, así que una sentencia que no
   * alcanza ninguna fila no dispara ninguno y "tiene éxito" sin haber modificado nada —
   * que probaría lo contrario de lo que este bloque quiere probar.
   *
   * Y para que `hs_migrator` alcance una fila de `incident` hacen falta las TRES
   * variables, no solo el sitio: `FORCE ROW LEVEL SECURITY` hace que el dueño de la
   * tabla quede sujeto a sus propias políticas, y la `RESTRICTIVE` de 0012 exige cuenta
   * o rol. Que el rol de migración no vea un incidente por defecto es la política
   * funcionando, no un obstáculo del test.
   */
  // Una función y no una constante: el cuerpo del `describe` corre antes que
  // `beforeAll`, así que `coordinator` todavía no existe cuando se evalúa.
  const asMigratorSession = () => ({
    siteIds: [SITE_A],
    userId: coordinator.accountId,
    role: 'hs_coordinator',
  });

  it('el rol de migración lo frena el trigger, no el privilegio', async () => {
    await investigated();

    for (const table of TABLES) {
      await expect(
        inSession(db.migrator, asMigratorSession(), `UPDATE ${table} SET site_id = site_id`),
      ).rejects.toSatisfy((error) => sqlstate(error) === 'HS001');
    }
  });

  it('ninguna de las cinco se puede borrar ni truncar', async () => {
    await investigated();

    for (const table of TABLES) {
      await expect(
        inSession(db.migrator, asMigratorSession(), `DELETE FROM ${table}`),
      ).rejects.toSatisfy((error) => sqlstate(error) === 'HS001');

      // El de TRUNCATE sí es por SENTENCIA —TRUNCATE no dispara triggers de fila—, así
      // que frena aunque la transacción no vea ninguna fila.
      await expect(db.migrator.query(`TRUNCATE ${table} CASCADE`)).rejects.toBeTruthy();
    }
  });

  it('un evento no se puede borrar para deshacer un cierre', async () => {
    const incidentId = await investigated();
    await incidents.transition(asCoordinator(), incidentId, { to: 'closed' });

    await expect(
      inSession(db.migrator, asMigratorSession(), 'DELETE FROM incident_event WHERE incident_id = $1', [
        incidentId,
      ]),
    ).rejects.toSatisfy((error) => sqlstate(error) === 'HS001');

    expect(await stateOf(incidentId)).toBe('closed');
  });
});

// ---------------------------------------------------------------------------

describe('la visibilidad angosta', () => {
  it('un supervisor no ve el incidente de otro supervisor de la misma planta', async () => {
    const mine = await report({}, asSupervisor());
    const theirs = await report({}, asOtherSupervisor());

    const list = await incidents.list(asSupervisor());
    const ids = list.map((incident) => incident.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('el coordinador y gerencia ven todos los de su alcance', async () => {
    const mine = await report({}, asSupervisor());
    const theirs = await report({}, asOtherSupervisor());

    for (const session of [asCoordinator(), asManager()]) {
      const ids = (await incidents.list(session)).map((incident) => incident.id);

      expect(ids).toContain(mine);
      expect(ids).toContain(theirs);
    }
  });

  it('el coordinador sigue acotado por sitio', async () => {
    const atB = await incidents.report(
      asSupervisorB(),
      payload({ subject_person_id: subjectB, location_id: locationB }),
    );


    const ids = (
      await incidents.list(sessionFor(coordinator.accountId, 'hs_coordinator', [SITE_A]))
    ).map((incident) => incident.id);

    expect(ids).not.toContain(atB.id);
  });

  it('un incidente invisible se responde igual que uno inexistente', async () => {
    const theirs = await report({}, asOtherSupervisor());

    await expect(incidents.get(asSupervisor(), theirs)).rejects.toMatchObject({
      response: { code: 'incident_not_found' },
    });

    await expect(incidents.get(asSupervisor(), randomUUID())).rejects.toMatchObject({
      response: { code: 'incident_not_found' },
    });
  });

  it('la restricción sobrevive a un SELECT crudo dentro de la transacción', async () => {
    const mine = await report({}, asSupervisor());
    const theirs = await report({}, asOtherSupervisor());

    const rows = await inSession<{ id: string }>(
      db.app,
      { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
      'SELECT id FROM incident',
    );

    const ids = rows.map((row) => row.id);

    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('las hijas siguen la visibilidad del padre', async () => {
    const theirs = await investigatedBy(asOtherSupervisor());

    for (const table of ['incident_event', 'incident_witness']) {
      const rows = await inSession<{ count: string }>(
        db.app,
        { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
        `SELECT count(*) FROM ${table} WHERE incident_id = $1`,
        [theirs],
      );

      expect(one(rows).count).toBe('0');
    }

    const investigations = await inSession<{ count: string }>(
      db.app,
      { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
      'SELECT count(*) FROM investigation WHERE incident_id = $1',
      [theirs],
    );

    expect(one(investigations).count).toBe('0');
  });

  /**
   * EL MODO DE FALLA CERRADO. Sin rol declarado la política no encuentra a nadie, y eso
   * es lo deseado: un olvido se manifiesta como "no veo nada" —que se investiga— y no
   * como "veo de más", que no se nota.
   */
  it('una transacción sin rol no ve ningún incidente, aunque existan', async () => {
    await report();

    const rows = await inSession<{ count: string }>(
      db.app,
      { siteIds: [SITE_A], userId: null, role: null },
      'SELECT count(*) FROM incident',
    );

    expect(one(rows).count).toBe('0');
  });

  /**
   * La otra mitad del modo de falla cerrado: el rol tampoco puede SOBREVIVIR a su
   * transacción. `set_config(..., true)` es `SET LOCAL`, y sin eso una conexión devuelta
   * al pool arrastraría el rol del request anterior — que en esta tabla significa que
   * un supervisor podría leer con el rol del coordinador que usó la conexión antes.
   */
  it('el rol no sobrevive a la transacción sobre una conexión reusada del pool', async () => {
    await report();

    // `max: 1`: la segunda transacción usa por fuerza la misma conexión física.
    const single = db.singleConnectionApp();

    const asCoordinatorFirst = await inSession<{ count: string }>(
      single,
      { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
      'SELECT count(*)::text AS count FROM incident',
    );

    const withoutRole = await inSession<{ count: string }>(
      single,
      { siteIds: [SITE_A], userId: null, role: null },
      'SELECT count(*)::text AS count FROM incident',
    );

    expect(Number(one(asCoordinatorFirst).count)).toBeGreaterThan(0);
    expect(one(withoutRole).count).toBe('0');

    // Sin `single.end()`: `startTestDatabase` lleva la lista de los pools extra y los
    // cierra en `stop()`. Cerrarlo acá lo cerraría dos veces y el segundo `end()` tira.
  });

  it('nadie inserta un incidente a nombre de otra cuenta', async () => {
    await expect(
      inSession(
        db.app,
        { siteIds: [SITE_A], userId: supervisor.accountId, role: 'supervisor' },
        `INSERT INTO incident
           (site_id, form_version, classification, subject_person_id, reported_by,
            occurred_at, location_id, task_performed, equipment_involved, what_happened,
            body_part, on_site_treatment, immediate_action, narrative_language)
         VALUES ($1, 1, 'first_aid', $2, $3, now(), $4, 'task', 'equipment',
                 'what happened', 'hand_or_finger', 'none', 'immediate', 'en')`,
        [SITE_A, subject, otherSupervisor.accountId, locationA],
      ),
    ).rejects.toSatisfy((error) => sqlstate(error) === '42501');
  });

  async function investigatedBy(session: ReturnType<typeof sessionFor>): Promise<string> {
    const { id: incidentId } = await incidents.report(
      session,
      payload({ classification: 'critical_injury', witness_person_ids: [witness] }),
    );

    await incidents.transition(asCoordinator(), incidentId, {
      to: 'under_investigation',
      method: 'five_whys',
    });

    return incidentId;
  }
});

// ---------------------------------------------------------------------------

describe('los relojes regulatorios', () => {
  it('no existen como columna', async () => {
    const columns = await inScope<{ column_name: string }>(
      db.migrator,
      [],
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'incident'`,
    );

    const names = columns.map((column) => column.column_name);

    for (const name of names) {
      expect(name).not.toMatch(/due|deadline|clock|form7|submitted/);
    }
  });

  it('una lesión crítica trae el aviso inmediato, el informe de 48 h y el Form 7', async () => {
    const incident = await incidents.report(
      asSupervisor(),
      payload({ classification: 'critical_injury' }),
    );

    const obligations = incident.clocks.map((clock) => clock.obligation).sort();

    expect(obligations).toEqual([
      'mlitsd_immediate_notice',
      'mlitsd_written_report',
      'wsib_form7',
    ]);

    const immediate = incident.clocks.find((clock) => clock.immediate);

    expect(immediate?.due_at).toBeNull();
    expect(immediate?.overdue).toBe(false);
    expect(immediate?.citation).toContain('OHSA');
  });

  it('los primeros auxilios no traen ninguna obligación', async () => {
    const incident = await incidents.report(
      asSupervisor(),
      payload({ classification: 'first_aid' }),
    );

    expect(incident.clocks).toEqual([]);
  });

  it('el reporte tardío deja los relojes del MLITSD vencidos y el del WSIB corriendo', async () => {
    const incident = await incidents.report(
      asSupervisor(),
      payload({ classification: 'critical_injury', occurred_at: '2026-03-02T08:00:00-05:00' }),
    );

    const written = incident.clocks.find(
      (clock) => clock.obligation === 'mlitsd_written_report',
    );
    const form7 = incident.clocks.find((clock) => clock.obligation === 'wsib_form7');

    expect(written?.counts_from).toBe('occurrence');
    expect(written?.overdue).toBe(true);

    expect(form7?.counts_from).toBe('report');
    expect(form7?.overdue).toBe(false);
  });

  it('dos lecturas separadas dan el mismo plazo', async () => {
    const incidentId = await report({ classification: 'lost_time_or_modified_work' });

    const first = await incidents.get(asCoordinator(), incidentId);
    const second = await incidents.get(asCoordinator(), incidentId);

    expect(first.clocks.map((clock) => clock.due_at)).toEqual(
      second.clocks.map((clock) => clock.due_at),
    );
  });

  it('no hay ninguna columna ni ruta que diga que se presentó ante un organismo', async () => {
    const incidentId = await report();
    const incident = await incidents.get(asCoordinator(), incidentId);

    expect(incident).not.toHaveProperty('submitted_at');
    for (const clock of incident.clocks) {
      expect(clock).not.toHaveProperty('submitted');
    }
  });
});

// ---------------------------------------------------------------------------

describe('la pantalla del Form 7', () => {
  it('mapea con la versión del incidente y marca lo que el sistema no almacena', async () => {
    const incidentId = await report();
    const { incident, mapping } = await incidents.form7(asCoordinator(), incidentId);

    expect(incident.form_version).toBe(1);
    expect(mapping.length).toBeGreaterThan(0);

    const notStored = mapping.filter((field) => field.notStored);

    expect(notStored.length).toBeGreaterThan(0);
    for (const field of notStored) {
      expect(field.note).toBeTruthy();
    }
  });

  it('la respuesta dice qué campos tenía la versión de este incidente', async () => {
    const incidentId = await report();
    const incident = await incidents.get(asCoordinator(), incidentId);

    expect(incident.fields_of_version).toContain('what_happened');
    expect(incident.fields_of_version).toHaveLength(9);
  });
});

// ---------------------------------------------------------------------------

describe('lo que el sistema se niega a guardar', () => {
  it('no hay ninguna columna de detalle clínico', async () => {
    const columns = await inScope<{ column_name: string }>(
      db.migrator,
      [],
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'incident'`,
    );

    const names = columns.map((column) => column.column_name);

    for (const forbidden of [
      'diagnosis',
      'medical_report',
      'work_restriction',
      'injury_nature',
      'nature_of_injury',
      'treatment_details',
      'photo',
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('no existe tabla de fotos del incidente', async () => {
    const tables = await inScope<{ table_name: string }>(
      db.migrator,
      [],
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name LIKE 'incident%'`,
    );

    expect(tables.map((table) => table.table_name).sort()).toEqual([
      'incident',
      'incident_event',
      'incident_witness',
    ]);
  });

  it('el reportante no puede ser el sujeto', async () => {
    await expect(
      incidents.report(asSupervisor(), payload({ subject_person_id: supervisor.personId })),
    ).rejects.toMatchObject({
      response: { code: 'first_person_report_not_supported' },
    });
  });

  it('una persona dada de baja no puede ser sujeto', async () => {
    const retired = await createPerson(db.app, SITE_A);

    // Con el sitio declarado: `person` lleva FORCE RLS, así que un UPDATE sin
    // `app.site_ids` no alcanza ninguna fila y la persona seguiría activa.
    await inScope(db.migrator, [SITE_A], 'UPDATE person SET deactivated_at = now() WHERE id = $1', [
      retired,
    ]);

    await expect(
      incidents.report(asSupervisor(), payload({ subject_person_id: retired })),
    ).rejects.toMatchObject({ response: { code: 'person_not_active' } });
  });

  it('una persona de la otra planta no puede ser sujeto', async () => {
    await expect(
      incidents.report(asSupervisor(), payload({ subject_person_id: subjectB })),
    ).rejects.toMatchObject({ response: { code: 'person_not_active' } });
  });

  it('un evento en el futuro se rechaza', async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await expect(
      incidents.report(asSupervisor(), payload({ occurred_at: tomorrow })),
    ).rejects.toMatchObject({ response: { code: 'occurred_at_in_future' } });
  });

  it('el `reported_at` es el del servidor y el `form_version` el del código', async () => {
    const before = Date.now();
    const incident = await incidents.report(asSupervisor(), payload());
    const after = Date.now();

    const reportedAt = new Date(incident.reported_at).getTime();

    expect(reportedAt).toBeGreaterThanOrEqual(before - 1000);
    expect(reportedAt).toBeLessThanOrEqual(after + 1000);
    expect(incident.form_version).toBe(1);
  });

  it('la narrativa se guarda exacta, con su idioma, y sin traducción', async () => {
    const spanish = 'La carga se corrió y golpeó al operario en la mano izquierda';

    const incident = await incidents.report(
      asSupervisor(),
      payload({ what_happened: spanish, narrative_language: 'es' }),
    );

    expect(incident.what_happened).toBe(spanish);
    expect(incident.narrative_language).toBe('es');
    expect(incident).not.toHaveProperty('what_happened_en');
  });
});

// ---------------------------------------------------------------------------

describe('la notificación al coordinador', () => {
  it('llega, y no lleva la identidad del sujeto', async () => {
    const incidentId = await report({ classification: 'critical_injury' });

    const rows = await inScope<{ payload: Record<string, unknown> }>(
      db.app,
      [SITE_A],
      `SELECT payload FROM notification
        WHERE kind = 'incident_reported' AND dedupe_key = $1 AND user_id = $2`,
      [incidentId, coordinator.accountId],
    );

    const payloadRow = one(rows).payload;

    expect(payloadRow.incident_id).toBe(incidentId);
    expect(payloadRow.classification).toBe('critical_injury');

    for (const forbidden of [
      'subject_person_id',
      'employee_number',
      'first_name',
      'last_name',
      'what_happened',
      'task_performed',
    ]) {
      expect(payloadRow).not.toHaveProperty(forbidden);
    }
  });

  it('el supervisor que reportó no recibe una notificación de su propio reporte', async () => {
    const incidentId = await report();

    const rows = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*) FROM notification WHERE dedupe_key = $1 AND user_id = $2`,
      [incidentId, supervisor.accountId],
    );

    expect(one(rows).count).toBe('0');
  });
});

// ---------------------------------------------------------------------------

describe('la auditoría', () => {
  it('el reporte deja su eslabón, sin narrativa y sin nombre', async () => {
    const incidentId = await report({ witness_person_ids: [witness] });

    const rows = await inScope<{ payload: Record<string, unknown>; event_type: string }>(
      db.app,
      [SITE_A],
      `SELECT event_type, payload FROM audit_log
        WHERE event_type = 'incident.reported' AND payload->>'incident_id' = $1`,
      [incidentId],
    );

    const entry = one(rows);

    expect(entry.payload.classification).toBe('health_care');
    expect(entry.payload.witness_count).toBe(1);
    expect(entry.payload.subject_person_id).toBe(subject);

    for (const forbidden of [
      'what_happened',
      'task_performed',
      'equipment_involved',
      'immediate_action',
      'first_name',
      'last_name',
      'employee_number',
    ]) {
      expect(entry.payload).not.toHaveProperty(forbidden);
    }
  });

  it('cada transición y cada causa dejan el suyo, y la causa va sin su texto', async () => {
    const incidentId = await investigated();

    const transitions = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*) FROM audit_log
        WHERE event_type = 'incident.transitioned' AND payload->>'incident_id' = $1`,
      [incidentId],
    );

    expect(one(transitions).count).toBe('2');

    const opened = await inScope<{ payload: Record<string, unknown> }>(
      db.app,
      [SITE_A],
      `SELECT payload FROM audit_log
        WHERE event_type = 'investigation.opened' AND payload->>'incident_id' = $1`,
      [incidentId],
    );

    expect(one(opened).payload.method).toBe('five_whys');

    const causes = await inScope<{ payload: Record<string, unknown> }>(
      db.app,
      [SITE_A],
      `SELECT payload FROM audit_log WHERE event_type = 'investigation.cause_recorded'
        ORDER BY seq DESC LIMIT 1`,
    );

    const cause = one(causes).payload;

    expect(cause.is_root).toBe(true);
    expect(cause).not.toHaveProperty('statement');
  });

  it('un reporte rechazado no deja entrada', async () => {
    const before = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*) FROM audit_log WHERE event_type = 'incident.reported'`,
    );

    await expect(
      incidents.report(asSupervisor(), payload({ subject_person_id: subjectB })),
    ).rejects.toBeTruthy();

    const after = await inScope<{ count: string }>(
      db.app,
      [SITE_A],
      `SELECT count(*) FROM audit_log WHERE event_type = 'incident.reported'`,
    );

    expect(after[0]?.count).toBe(before[0]?.count);
  });
});

// ---------------------------------------------------------------------------

describe('el segundo padre de la acción correctiva', () => {
  it('una acción de investigación se crea con la severidad que declara el coordinador', async () => {
    const incidentId = await investigated();
    const rows = await inSession<{ id: string }>(
      db.app,
      { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
      'SELECT id FROM investigation WHERE incident_id = $1',
      [incidentId],
    );

    const action = await actions.createForInvestigation(asCoordinator(), one(rows).id, {
      assignee_person_id: supervisor.personId,
      description: 'Replace the bypassed interlock on the changeover guard',
      severity: 'catastrophic',
    });

    expect(action.finding_id).toBeNull();
    expect(action.investigation_id).toBe(one(rows).id);
    expect(action.severity).toBe('catastrophic');

    // `catastrophic` son 3 días en la misma tabla que usan las acciones de hallazgo.
    const days =
      (new Date(action.due_at).getTime() - new Date(action.created_at).getTime()) /
      (24 * 60 * 60 * 1000);

    expect(Math.round(days)).toBe(3);
  });

  it('la acción de una investigación recorre el mismo ciclo, con el mismo verificador distinto', async () => {
    const incidentId = await investigated();
    const actionId = await openActionOn(incidentId);

    await actions.transition(asSupervisor(), actionId, { to: 'in_progress', evidence: [] });
    await actions.transition(asSupervisor(), actionId, {
      to: 'awaiting_verification',
      evidence: [{ kind: 'after', object_key: evidenceKey(actionId) }],
    });

    // El ejecutor no puede verificar su propio trabajo, igual que en una de hallazgo.
    await expect(
      actions.transition(asSupervisor(), actionId, { to: 'closed', evidence: [] }),
    ).rejects.toMatchObject({ response: { code: 'verifier_is_executor' } });

    await expect(
      actions.transition(asCoordinator(), actionId, { to: 'closed', evidence: [] }),
    ).resolves.toMatchObject({ state: 'closed' });
  });

  it('una acción con dos padres o sin ninguno se rechaza', async () => {
    const incidentId = await investigated();
    const rows = await inSession<{ id: string }>(
      db.app,
      { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
      'SELECT id FROM investigation WHERE incident_id = $1',
      [incidentId],
    );

    const investigationId = one(rows).id;

    for (const [findingId, investigation] of [
      [null, null],
      [randomUUID(), investigationId],
    ] as const) {
      await expect(
        inSession(
          db.app,
          { siteIds: [SITE_A], userId: coordinator.accountId, role: 'hs_coordinator' },
          `INSERT INTO corrective_action
             (site_id, finding_id, investigation_id, assignee_person_id, description,
              severity, due_at, created_by)
           VALUES ($1, $2, $3, $4, 'a description long enough', 'major', now(), $5)`,
          [SITE_A, findingId, investigation, supervisor.personId, coordinator.accountId],
        ),
      ).rejects.toBeTruthy();
    }
  });

  it('las acciones escritas antes del segundo padre siguen siendo válidas', async () => {
    const rows = await inScope<{ validated: boolean }>(
      db.migrator,
      [],
      `SELECT convalidated AS validated
         FROM pg_constraint
        WHERE conname = 'corrective_action_one_parent_check'`,
    );

    expect(one(rows).validated).toBe(true);
  });
});
