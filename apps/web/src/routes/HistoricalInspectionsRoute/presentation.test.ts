import type { ScheduledInspection } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { inspectionHistoryForType, inspectionTypeGroups } from './presentation';

function inspection(overrides: Partial<ScheduledInspection> = {}): ScheduledInspection {
  return {
    id: 'scheduled-1',
    site_id: 'site-1',
    period_start: '2027-07-01',
    period_months: 1,
    period_end: '2027-07-31',
    template_id: 'template-1',
    template_name: 'Monthly workplace inspection',
    template_version_id: 'version-1',
    template_version: 1,
    inspector_id: 'user-1',
    inspector_name: 'Marie Tremblay',
    scheduled_at: '2027-07-01T00:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: false,
    status: 'completed',
    inspection_id: 'inspection-1',
    completed_at: '2027-07-29T18:00:00.000Z',
    ...overrides,
  };
}

describe('inspectionTypeGroups', () => {
  it('agrupa versiones por template_id, cuenta todas y conserva el nombre más reciente', () => {
    const groups = inspectionTypeGroups([
      inspection({ id: 'new', template_version: 2, template_name: 'Current name' }),
      inspection({ id: 'old', template_version: 1, template_name: 'Former name' }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.templateName).toBe('Current name');
    expect(groups[0]?.inspections.map((item) => item.id)).toEqual(['new', 'old']);
  });

  it('no une nombres iguales con identidades distintas y ordena por nombre', () => {
    const groups = inspectionTypeGroups([
      inspection({ template_id: 'z', template_name: 'Quarterly inspection' }),
      inspection({ template_id: 'b', template_name: 'Monthly inspection' }),
      inspection({ template_id: 'a', template_name: 'Monthly inspection' }),
    ]);

    expect(groups.map((group) => group.templateId)).toEqual(['b', 'a', 'z']);
  });
});

describe('inspectionHistoryForType', () => {
  it('filtra por template_id sin alterar el orden recibido', () => {
    const history = inspectionHistoryForType(
      [
        inspection({ id: 'july', template_id: 'chosen' }),
        inspection({ id: 'other', template_id: 'other' }),
        inspection({ id: 'may', template_id: 'chosen' }),
      ],
      'chosen',
    );

    expect(history.map((item) => item.id)).toEqual(['july', 'may']);
  });
});
