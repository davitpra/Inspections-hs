import { describe, expect, it } from 'vitest';
import type { ActionSummary, Finding, Session } from '@hs/contracts';
import type { TemplateDocument } from '@hs/forms';

import {
  actionsByFinding,
  blockingActions,
  findingDeadline,
  futureDueAt,
  nextStep,
  sectionsWithFindings,
  stageStatus,
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
