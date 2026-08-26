import { describe, expect, it } from 'vitest';
import type { ActionSummary } from '@hs/contracts';

import {
  inspectionGroupLabel,
  matchesInspectionGroup,
  siteOptions,
  sourceLabel,
  sourceOptions,
  visibleActions,
} from './presentation';

const SITE_A = '11111111-1111-4111-8111-111111111111';
const SITE_B = '22222222-2222-4222-8222-222222222222';
const TEMPLATE_A = '33333333-3333-4333-8333-333333333333';
const TEMPLATE_B = '44444444-4444-4444-8444-444444444444';

function action(overrides: Partial<ActionSummary> = {}): ActionSummary {
  return {
    id: '55555555-5555-4555-8555-555555555555',
    site_id: SITE_A,
    site_name: 'St. Thomas',
    assignee_person_id: '66666666-6666-4666-8666-666666666666',
    assignee_name: 'Dana Okafor',
    description: 'Install a fixed guard on line 3',
    severity: 'major',
    due_at: '2026-08-28T16:00:00.000Z',
    state: 'open',
    overdue: false,
    escalations: [],
    source: {
      kind: 'inspection',
      finding_id: '77777777-7777-4777-8777-777777777777',
      inspection_id: '88888888-8888-4888-8888-888888888888',
      scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
      template_id: TEMPLATE_A,
      template_name: 'Monthly walkthrough',
    },
    ...overrides,
  };
}

describe('la presentación del listado de acciones', () => {
  it('muestra solo trabajo activo por defecto y conserva el orden del servidor', () => {
    const first = action({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
    const closed = action({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', state: 'closed' });
    const second = action({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', state: 'in_progress' });

    expect(
      visibleActions([first, closed, second], { status: 'active', source: 'all', site: 'all' }).map(
        (item) => item.id,
      ),
    ).toEqual([first.id, second.id]);
  });

  it('combina los filtros de estado, template y sitio', () => {
    const matching = action({ state: 'awaiting_verification' });
    const otherTemplate = action({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      source: {
        kind: 'inspection',
        finding_id: '77777777-7777-4777-8777-777777777777',
        inspection_id: '88888888-8888-4888-8888-888888888888',
        scheduled_inspection_id: '99999999-9999-4999-8999-999999999999',
        template_id: TEMPLATE_B,
        template_name: 'Quarterly equipment review',
      },
    });
    const otherSite = action({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      site_id: SITE_B,
      site_name: 'Glencoe',
      state: 'awaiting_verification',
    });

    expect(
      visibleActions([otherTemplate, otherSite, matching], {
        status: 'awaiting_verification',
        source: `template:${TEMPLATE_A}`,
        site: SITE_A,
      }),
    ).toEqual([matching]);
  });

  it('ofrece templates una vez y conserva las fuentes sin template', () => {
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

    expect(sourceOptions([action(), action(), manual, investigation]).map((item) => item.label)).toEqual([
      'All sources',
      'Monthly walkthrough',
      'Manual findings',
      'Incident investigations',
    ]);
    expect(sourceLabel(manual)).toBe('Manual finding');
    expect(sourceLabel(investigation)).toBe('Incident investigation');
  });

  it('ordena alfabéticamente los sitios sin duplicarlos', () => {
    expect(
      siteOptions([
        action(),
        action({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
        action({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', site_id: SITE_B, site_name: 'Glencoe' }),
      ]),
    ).toEqual([
      { value: SITE_B, label: 'Glencoe' },
      { value: SITE_A, label: 'St. Thomas' },
    ]);
  });

  it('reconoce el grupo de una inspección y agrupa lo que no tiene inspección en "other"', () => {
    const fromInspection = action();
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

    expect(matchesInspectionGroup(fromInspection, '88888888-8888-4888-8888-888888888888')).toBe(
      true,
    );
    expect(matchesInspectionGroup(fromInspection, 'other')).toBe(false);
    expect(matchesInspectionGroup(manual, 'other')).toBe(true);
    expect(matchesInspectionGroup(investigation, 'other')).toBe(true);

    expect(
      inspectionGroupLabel([fromInspection], '88888888-8888-4888-8888-888888888888'),
    ).toBe('Monthly walkthrough');
    expect(inspectionGroupLabel([manual, investigation], 'other')).toBe('Other sources');
  });
});
