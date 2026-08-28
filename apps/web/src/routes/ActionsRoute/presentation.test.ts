import { describe, expect, it } from 'vitest';
import type { ActionSummary } from '@hs/contracts';

import { groupActionsByInspection } from './presentation';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_A = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_B = '44444444-4444-4444-8444-444444444444';
const INSPECTION_A = '88888888-8888-4888-8888-888888888888';
const INSPECTION_B = '99999999-9999-4999-8999-999999999998';

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
      finding_id: '77777777-7777-4777-8777-777777777777',
      inspection_id: INSPECTION_A,
      scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
      template_id: TEMPLATE_A,
      template_name: 'Monthly walkthrough',
    },
    ...overrides,
  };
}

describe('la agrupación de acciones por inspección', () => {
  it('agrupa por inspection_id y junta lo que no tiene inspección en "other"', () => {
    const manual = action({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: { kind: 'manual_finding', finding_id: '77777777-7777-4777-8777-777777777777' },
    });
    const investigation = action({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      source: {
        kind: 'investigation',
        investigation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
    });

    const groups = groupActionsByInspection([action(), manual, investigation]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      id: INSPECTION_A,
      templateName: 'Monthly walkthrough',
      siteName: 'St. Thomas',
      total: 1,
    });
    expect(groups[1]).toMatchObject({ id: 'other', templateName: 'Other sources', total: 2 });
  });

  it('cuenta activas y vencidas por grupo', () => {
    const closed = action({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      state: 'closed',
      overdue: false,
    });
    const overdue = action({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      overdue: true,
      due_at: '2026-08-01T00:00:00.000Z',
    });

    const [group] = groupActionsByInspection([action(), closed, overdue]);

    expect(group).toMatchObject({ total: 3, active: 2, overdue: 1 });
    expect(group!.earliestActiveDueAt).toBe('2026-08-01T00:00:00.000Z');
  });

  it('ordena por el vencimiento activo más próximo y deja "other" al final', () => {
    const urgent = action({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      site_id: SITE_B,
      site_name: 'Glencoe',
      due_at: '2026-08-01T00:00:00.000Z',
      source: {
        kind: 'inspection',
        finding_id: '77777777-7777-4777-8777-777777777777',
        inspection_id: INSPECTION_B,
        scheduled_inspection_id: '99999999-9999-4999-8999-999999999997',
        template_id: TEMPLATE_B,
        template_name: 'Quarterly equipment review',
      },
    });
    const manual = action({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      source: { kind: 'manual_finding', finding_id: '77777777-7777-4777-8777-777777777777' },
    });

    expect(groupActionsByInspection([action(), manual, urgent]).map((group) => group.id)).toEqual(
      [INSPECTION_B, INSPECTION_A, 'other'],
    );
  });
});
