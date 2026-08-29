import { describe, expect, it } from 'vitest';
import type { ActionSummary } from '@hs/contracts';

import { actionsByFinding, futureDueAt } from './presentation';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const FINDING_A = '77777777-7777-4777-8777-777777777777';
const FINDING_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const INSPECTION_A = '88888888-8888-4888-8888-888888888888';

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
