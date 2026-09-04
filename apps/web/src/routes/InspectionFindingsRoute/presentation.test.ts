import { describe, expect, it } from 'vitest';
import {
  transitionsFrom,
  type ActionEvent,
  type ActionState,
  type ActionSummary,
  type Finding,
  type Session,
} from '@hs/contracts';
import type { TemplateDocument } from '@hs/forms';

import { canAttempt } from '../../permissions/actions';
import {
  actionsByFinding,
  blockingActions,
  commitmentRequest,
  eventLabel,
  eventsInStage,
  findingDeadline,
  futureDueAt,
  nextStep,
  openableStages,
  sectionsWithFindings,
  stageStatus,
  stepForm,
  toDateTimeLocal,
} from './presentation';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const FINDING_A = '77777777-7777-4777-8777-777777777777';
const FINDING_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INSPECTION_A = '88888888-8888-4888-8888-888888888888';

function session(
  role: Session['role'],
  personId = action().assignee_person_id,
  userId = '44444444-4444-4444-8444-444444444444',
): Session {
  return {
    userId,
    personId,
    role,
    siteScope: [SITE_A],
    recordsFrom: null,
    recordsTo: null,
  };
}

function action(overrides: Partial<ActionSummary> = {}): ActionSummary {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    site_id: SITE_A,
    site_name: 'St. Thomas',
    assignee_person_id: '66666666-6666-4666-8666-666666666666',
    assignee_name: 'Dana Okafor',
    description: 'Install a fixed guard on line 3',
    due_at: '2026-08-28T16:00:00.000Z',
    state: 'open',
    overdue: false,
    escalations: [],
    source: {
      kind: 'inspection',
      finding_id: FINDING_A,
      inspection_id: INSPECTION_A,
      scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
      template_id: '33333333-3333-4333-8333-333333333333',
      template_name: 'Monthly walkthrough',
    },
    ...overrides,
  };
}

const GUARDS = 'general.guards';
const AISLES = 'general.aisles';
const EXITS = 'exits.lit';

/**
 * Dos secciones, y en la primera dos preguntas escritas al revés de su `position`: el orden
 * que se afirma abajo tiene que salir del documento y no del arreglo.
 */
function document(): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'exits',
        section_title: 'Emergency exits',
        position: 2,
        items: [
          {
            item_key: EXITS,
            prompt: 'Exit signs lit',
            position: 1,
            required: true,
            response_type: 'yes_no',
            fails_on: 'no',
          },
        ],
      },
      {
        section_key: 'general',
        section_title: 'Work areas and housekeeping',
        position: 1,
        items: [
          {
            item_key: AISLES,
            prompt: 'Aisles kept clear',
            position: 2,
            required: true,
            response_type: 'yes_no',
            fails_on: 'no',
            visible_when: { item_key: GUARDS, operator: 'equals', value: false },
          },
          {
            item_key: GUARDS,
            prompt: 'Machine guards in place',
            position: 1,
            required: true,
            response_type: 'yes_no',
            fails_on: 'no',
          },
        ],
      },
    ],
  };
}

function itemFinding(itemKey: string, overrides: Partial<Finding> = {}): Finding {
  return {
    id: FINDING_A,
    site_id: SITE_A,
    origin: 'inspection',
    inspection_id: INSPECTION_A,
    template_version_item_id: '22222222-2222-4222-8222-222222222222',
    item_key: itemKey,
    location_id: null,
    description: `Something went wrong at ${itemKey}`,
    state: 'raised',
    photo_object_keys: [],
    reported_by: '44444444-4444-4444-8444-444444444444',
    occurred_at: '2026-08-28T16:00:00.000Z',
    recorded_at: '2026-08-28T16:05:00.000Z',
    ...overrides,
  };
}

describe('el recorte de un envío a lo que salió mal', () => {
  it('deja afuera la pregunta limpia y la sección que no dejó ningún hallazgo', () => {
    const sections = sectionsWithFindings(
      document(),
      { [GUARDS]: false, [AISLES]: true, [EXITS]: true },
      [itemFinding(GUARDS)],
    );

    expect(
      sections.map(([section, found]) => [
        section.section_key,
        found.map(({ item }) => item.item_key),
      ]),
    ).toEqual([['general', [GUARDS]]]);
  });

  it('empareja cada pregunta con el hallazgo que registró', () => {
    const finding = itemFinding(GUARDS);

    const sections = sectionsWithFindings(document(), { [GUARDS]: false }, [finding]);

    expect(sections[0]?.[1][0]?.item.prompt).toBe('Machine guards in place');
    expect(sections[0]?.[1][0]?.finding).toBe(finding);
  });

  it('recorre las secciones y las preguntas en orden de documento', () => {
    const sections = sectionsWithFindings(
      document(),
      { [GUARDS]: false, [AISLES]: false, [EXITS]: false },
      [
        itemFinding(EXITS, { id: FINDING_B }),
        itemFinding(AISLES, { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
        itemFinding(GUARDS),
      ],
    );

    expect(
      sections.map(([section, found]) => [
        section.section_key,
        found.map(({ item }) => item.item_key),
      ]),
    ).toEqual([
      ['general', [GUARDS, AISLES]],
      ['exits', [EXITS]],
    ]);
  });

  /*
    Un hallazgo de una pregunta que la condición escondió no puede existir, y si existiera,
    esta pantalla no es donde se descubre: lo que se dibuja es la recorrida que hubo.
  */
  it('no dibuja el hallazgo de una pregunta que una condición escondió', () => {
    const sections = sectionsWithFindings(document(), { [GUARDS]: true }, [
      itemFinding(AISLES),
    ]);

    expect(sections).toEqual([]);
  });

  it('deja afuera el hallazgo manual, que no señala ninguna pregunta del documento', () => {
    const sections = sectionsWithFindings(document(), { [GUARDS]: false }, [
      itemFinding(GUARDS, { origin: 'manual', inspection_id: null, item_key: null }),
    ]);

    expect(sections).toEqual([]);
  });
});

describe('las acciones de cada hallazgo', () => {
  it('no inventa una entrada para un hallazgo sin acciones', () => {
    expect(actionsByFinding([]).get(FINDING_A)).toBeUndefined();
  });

  it('junta varias acciones del mismo hallazgo en el orden recibido', () => {
    const second = action({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', state: 'closed' });

    expect(actionsByFinding([action(), second]).get(FINDING_A)?.map((item) => item.id)).toEqual([
      action().id,
      second.id,
    ]);
  });

  it('separa los hallazgos y conserva el hallazgo manual', () => {
    const manual = action({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      source: { kind: 'manual_finding', finding_id: FINDING_B },
    });

    const grouped = actionsByFinding([action(), manual]);

    expect(grouped.get(FINDING_A)?.map((item) => item.id)).toEqual([action().id]);
    expect(grouped.get(FINDING_B)?.map((item) => item.id)).toEqual([manual.id]);
  });

  it('deja afuera la acción de una investigación, que no señala ningún hallazgo', () => {
    const investigation = action({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      source: {
        kind: 'investigation',
        investigation_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      },
    });

    expect(actionsByFinding([investigation]).size).toBe(0);
  });
});

describe('la presentación del estado propio del hallazgo', () => {
  it('marca los segmentos con respecto al estado persistido', () => {
    expect(blockingActions([], 'raised')).toEqual([]);
    expect(findingDeadline([], 'raised', '2026-08-28')).toBeNull();
    expect(stageStatus('raised', 'raised')).toBe('current');
    expect(stageStatus('assigned', 'raised')).toBe('todo');
  });

  it('elige las acciones que retienen el estado persistido', () => {
    const open = action();
    const closed = action({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      state: 'closed',
    });

    expect(blockingActions([closed, open], 'assigned')).toEqual([open]);
    expect(stageStatus('raised', 'assigned')).toBe('done');
  });

  it('no reinterpreta el estado a partir de una acción más avanzada', () => {
    expect(
      blockingActions(
        [action({ state: 'closed' }), action({ state: 'in_progress' })],
        'in_progress',
      ),
    ).toEqual([action({ state: 'in_progress' })]);
  });

  it('lee el plazo más cercano entre las acciones que bloquean', () => {
    const later = action({ due_at: '2026-09-07T16:00:00.000Z' });
    const nearer = action({
      id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      due_at: '2026-08-31T16:00:00.000Z',
    });

    expect(blockingActions([later, nearer], 'assigned').map((item) => item.id)).toEqual([
      nearer.id,
      later.id,
    ]);
    expect(findingDeadline([later, nearer], 'assigned', '2026-08-28')).toBe('in 3 days');
  });

  it('dice cuánto hace que venció el compromiso bloqueante', () => {
    expect(
      findingDeadline(
        [action({ state: 'in_progress', due_at: '2026-08-25T16:00:00.000Z', overdue: true })],
        'in_progress',
        '2026-08-28',
      ),
    ).toBe('3 days overdue');
  });
});

describe('el próximo paso del hallazgo', () => {
  it('ofrece la asignación al coordinador cuando todavía no hay acciones', () => {
    expect(nextStep([], 'raised', session('hs_coordinator'), itemFinding(GUARDS))).toEqual({
      label: 'Create corrective action',
      requirement: 'Assign a responsible person, describe the work, and set a deadline.',
      waitingOn: 'H&S coordinator or whoever raised the finding',
      control: { kind: 'create' },
      editableAssignment: null,
    });
  });

  /** ADR-017: quien reportó el hallazgo lo abre, aunque no sea el coordinador. */
  it('ofrece la asignación también a quien reportó el hallazgo', () => {
    const reporterId = '99999999-9999-4999-8999-999999999999';
    const reportedFinding = itemFinding(GUARDS, { reported_by: reporterId });

    expect(
      nextStep([], 'raised', session('jhsc_member', undefined, reporterId), reportedFinding)?.control,
    ).toEqual({ kind: 'create' });
  });

  it('no ofrece la asignación a un jhsc_member que no reportó el hallazgo', () => {
    const reportedByOther = itemFinding(GUARDS, {
      reported_by: '99999999-9999-4999-8999-999999999999',
    });

    expect(nextStep([], 'raised', session('jhsc_member'), reportedByOther)?.control).toBeNull();
  });

  it('ofrece al responsable la transición que sale de open', () => {
    expect(
      nextStep([action()], 'assigned', session('external_auditor'), itemFinding(GUARDS)),
    ).toMatchObject({
      label: 'Start work',
      waitingOn: 'Dana Okafor',
      control: { kind: 'progress', action: action() },
    });
  });

  it('ofrece la verificación al rol verificador', () => {
    expect(
      nextStep(
        [action({ state: 'awaiting_verification' })],
        'verification',
        session('supervisor'),
        itemFinding(GUARDS),
      ),
    ).toMatchObject({
      label: 'Verify and close',
      control: { kind: 'progress', action: action({ state: 'awaiting_verification' }) },
    });
  });

  it('nombra a quién espera cuando un miembro de JHSC no puede intentar nada', () => {
    expect(
      nextStep(
        [action({ state: 'in_progress' })],
        'in_progress',
        session('jhsc_member', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),
        itemFinding(GUARDS),
      ),
    ).toMatchObject({
      label: 'Declare the work done',
      waitingOn: 'Dana Okafor',
      control: null,
    });
  });

  it('no ofrece reapertura cuando todas las acciones están cerradas', () => {
    expect(
      nextStep(
        [action({ state: 'closed' })],
        'closed',
        session('hs_coordinator'),
        itemFinding(GUARDS),
      ),
    ).toBeNull();
  });

  /** ADR-020: la corrección permanece disponible hasta el cierre. */
  it('ofrece Edit assignment junto a Start work en assigned', () => {
    const step = nextStep([action()], 'assigned', session('hs_coordinator'), itemFinding(GUARDS));

    expect(step?.control).toEqual({ kind: 'progress', action: action() });
    expect(step?.editableAssignment).toEqual(action());
  });

  it('no ofrece Edit assignment a quien no puede abrir la acción', () => {
    const reportedByOther = itemFinding(GUARDS, {
      reported_by: '99999999-9999-4999-8999-999999999999',
    });

    expect(
      nextStep([action()], 'assigned', session('supervisor'), reportedByOther)?.editableAssignment,
    ).toBeNull();
  });

  it.each([
    ['in_progress', 'in_progress'],
    ['verification', 'awaiting_verification'],
  ] as const)('mantiene Edit assignment en %s', (findingState, actionState) => {
    expect(
      nextStep(
        [action({ state: actionState })],
        findingState,
        session('hs_coordinator'),
        itemFinding(GUARDS),
      )?.editableAssignment,
    ).toEqual(action({ state: actionState }));
  });
});

describe('los campos y las salidas del paso, etapa por etapa', () => {
  /** Lo mismo que arma el formulario antes de dibujar: la tabla, recortada por la cuenta. */
  function offered(state: ActionState, account: Session) {
    const current = action({ state });

    return transitionsFrom(state).filter((transition) =>
      canAttempt(transition, current, account),
    );
  }

  it('en Assigned no pide nada y ofrece una sola salida', () => {
    expect(stepForm('open', offered('open', session('external_auditor')))).toEqual({
      evidence: false,
      reason: false,
      note: false,
      choices: [{ to: 'in_progress', label: 'Start work' }],
    });
  });

  it('en In progress pide la evidencia y la nota antes de declarar el trabajo hecho', () => {
    expect(stepForm('in_progress', offered('in_progress', session('external_auditor')))).toEqual({
      evidence: true,
      reason: false,
      note: true,
      choices: [{ to: 'awaiting_verification', label: 'Declare the work done' }],
    });
  });

  it('en Verification pide la razón y ofrece las dos salidas, cerrar primero', () => {
    expect(
      stepForm(
        'awaiting_verification',
        offered('awaiting_verification', session('supervisor')),
      ),
    ).toEqual({
      evidence: false,
      reason: true,
      note: true,
      choices: [
        { to: 'closed', label: 'Verify and close' },
        { to: 'in_progress', label: 'Send it back' },
      ],
    });
  });

  /** El responsable declaró el trabajo hecho; verificarlo no es suyo (R3, ADR-016). */
  it('no hay formulario cuando la cuenta no puede pedir ninguna transición', () => {
    expect(
      stepForm(
        'awaiting_verification',
        offered('awaiting_verification', session('external_auditor')),
      ),
    ).toBeNull();
  });
});

describe('el registro de la etapa Assigned', () => {
  it('recorta el instante ISO a lo que espera datetime-local, sin mover el huso', () => {
    expect(toDateTimeLocal('2050-01-01T17:00:00.000Z')).toBe('2050-01-01T17:00');
    expect(toDateTimeLocal('2026-08-28T16:30:00-04:00')).toBe('2026-08-28T16:30');
  });
});

describe('el plazo del formulario', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');

  it('convierte datetime-local a un instante ISO', () => {
    const value = '2026-08-29T12:00';

    expect(futureDueAt(value, now)).toEqual({
      success: true,
      dueAt: new Date(value).toISOString(),
    });
  });

  it('rechaza un valor vacío o inválido', () => {
    expect(futureDueAt('', now)).toEqual({
      success: false,
      message: 'Choose a valid deadline.',
    });
  });

  it('rechaza un plazo que no es futuro', () => {
    expect(futureDueAt('2026-08-28T12:00:00.000Z', now)).toEqual({
      success: false,
      message: 'Deadline must be in the future.',
    });
  });
});

/**
 * LA MISMA REGLA PARA CREAR Y PARA EDITAR (ADR-020). Se prueba una vez porque es una sola:
 * si el compromiso que se asigna y el que se corrige se comprobaran distinto, la edición
 * aceptaría lo que crear rechaza sin que nada lo delate.
 */
describe('el compromiso escrito en los tres campos', () => {
  const now = new Date('2026-08-28T12:00:00.000Z');
  const PERSON = '99999999-9999-4999-8999-999999999999';
  const roster = [
    {
      id: PERSON,
      first_name: 'Ada',
      last_name: 'Lovelace',
      employee_number: '1042',
    },
  ];

  const draft = {
    assigneePersonId: PERSON,
    description: 'Install a fixed guard before restarting the line',
    dueAt: '2026-08-29T12:00',
  };

  it('devuelve el cuerpo que espera el servidor', () => {
    expect(commitmentRequest(draft, roster, now)).toEqual({
      success: true,
      request: {
        assignee_person_id: PERSON,
        description: draft.description,
        due_at: new Date(draft.dueAt).toISOString(),
      },
    });
  });

  /* Que la persona esté ACTIVA en esta planta no lo sabe `uuid()`, y el aviso que corresponde
     no es sobre la forma del dato sino sobre a quién se puede asignar. */
  it('rechaza a quien no está en el roster', () => {
    expect(
      commitmentRequest({ ...draft, assigneePersonId: FINDING_A }, roster, now),
    ).toEqual({
      success: false,
      message: 'Choose an active assignee from this site.',
    });
  });

  it('rechaza un plazo que no es futuro antes de mirar el trabajo', () => {
    expect(
      commitmentRequest({ ...draft, description: '', dueAt: '2026-08-01T12:00' }, roster, now),
    ).toEqual({ success: false, message: 'Deadline must be in the future.' });
  });

  it('rechaza una descripción demasiado corta', () => {
    expect(commitmentRequest({ ...draft, description: 'Fix it' }, roster, now)).toEqual({
      success: false,
      message: 'Description must be between 10 and 2000 characters.',
    });
  });
});

/**
 * Lo que hace navegable el ciclo: qué etapas se pueden abrir, qué guarda cada una y cómo se
 * nombra lo que pasó ahí. Las tres son decisiones sobre un registro que se defiende ante un
 * regulador, y por eso se prueban sin dibujar nada.
 */
describe('la lectura de una etapa', () => {
  function event(overrides: Partial<ActionEvent> = {}): ActionEvent {
    return {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      position: 0,
      from_state: null,
      to_state: 'open',
      actor_user_id: '44444444-4444-4444-8444-444444444444',
      note: null,
      reason: null,
      occurred_at: '2026-08-01T12:00:00.000Z',
      recorded_at: '2026-08-01T12:00:01.000Z',
      evidence: [],
      ...overrides,
    };
  }

  /**
   * Sin composición desplegada, solo lo que ya ocurrió. Los pasos de las otras tres etapas no
   * piden excepción: se leen en la etapa desde la que se ejecutan, alcanzada por definición.
   */
  it('solo se abre lo que ya ocurrió', () => {
    expect(openableStages('raised', null)).toEqual(['raised']);
    expect(openableStages('assigned', null)).toEqual(['raised', 'assigned']);
    expect(openableStages('closed', null)).toEqual([
      'raised',
      'assigned',
      'in_progress',
      'verification',
      'closed',
    ]);
  });

  /** La única etapa no alcanzada que se ofrece: la que el alta desplegada va a escribir. */
  it('agrega la etapa que la composición desplegada escribiría', () => {
    expect(openableStages('raised', 'assigned')).toEqual(['raised', 'assigned']);
  });

  /** Y no la duplica ni corre la lectura cuando esa etapa ya ocurrió. */
  it('no agrega dos veces una etapa ya alcanzada', () => {
    expect(openableStages('in_progress', 'assigned')).toEqual([
      'raised',
      'assigned',
      'in_progress',
    ]);
  });

  /** Las dos entradas a `in_progress` son de la misma etapa: empezar y volver a empezar. */
  it('reparte los eventos con la misma tabla que decide la etapa vigente', () => {
    const started = event({ position: 1, from_state: 'open', to_state: 'in_progress' });
    const sentBack = event({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      position: 3,
      from_state: 'awaiting_verification',
      to_state: 'in_progress',
    });
    const declared = event({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      position: 2,
      from_state: 'in_progress',
      to_state: 'awaiting_verification',
    });

    expect(eventsInStage([sentBack, declared, started], 'in_progress')).toEqual([
      started,
      sentBack,
    ]);
    expect(eventsInStage([sentBack, declared, started], 'verification')).toEqual([declared]);
    expect(eventsInStage([sentBack, declared, started], 'closed')).toEqual([]);
  });

  it('ordena por la posición del stream y no por el reloj', () => {
    const late = event({ position: 1, from_state: 'open', to_state: 'in_progress' });
    const early = event({
      id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
      position: 3,
      from_state: 'awaiting_verification',
      to_state: 'in_progress',
      occurred_at: '2020-01-01T00:00:00.000Z',
    });

    expect(eventsInStage([early, late], 'in_progress').map((item) => item.position)).toEqual([
      1, 3,
    ]);
  });

  /** El PAR y no el destino: leer "Send it back" donde alguien pulsó "Send it back". */
  it('nombra el evento con la etiqueta del botón que lo pidió', () => {
    expect(eventLabel(event({ from_state: 'open', to_state: 'in_progress' }))).toBe('Start work');
    expect(
      eventLabel(event({ from_state: 'awaiting_verification', to_state: 'in_progress' })),
    ).toBe('Send it back');
    // La creación no la nombró ningún botón.
    expect(eventLabel(event({ from_state: null, to_state: 'open' }))).toBe('Open');
  });
});
