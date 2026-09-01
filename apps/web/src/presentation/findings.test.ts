import type { Finding, ScheduledInspection } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { findingsLabel, inspectionsWithFindings, photoCountText } from './findings';

const SITE = '33333333-3333-4333-8333-333333333333';

describe('photoCountText', () => {
  it('nombra la ausencia y concuerda en número', () => {
    expect(photoCountText(0)).toBe('No photos');
    expect(photoCountText(1)).toBe('1 photo');
    expect(photoCountText(3)).toBe('3 photos');
  });
});

describe('findingsLabel', () => {
  it('concuerda en número', () => {
    expect(findingsLabel(1)).toBe('1 finding');
    expect(findingsLabel(3)).toBe('3 findings');
  });
});

function scheduled(overrides: Record<string, unknown> = {}): ScheduledInspection {
  return {
    id: 's-1',
    site_id: SITE,
    period_start: '2027-07-01',
    period_months: 1,
    period_end: '2027-07-31',
    template_id: 't-1',
    template_name: 'Monthly general workplace inspection',
    template_version_id: 'v-1',
    template_version: 1,
    inspector_id: '11111111-1111-4111-8111-111111111111',
    inspector_name: 'Marie Tremblay',
    scheduled_at: '2027-07-01T00:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: false,
    status: 'completed',
    inspection_id: 'insp-1',
    completed_at: '2027-07-29T18:00:00.000Z',
    ...overrides,
  } as ScheduledInspection;
}

function finding(overrides: Record<string, unknown> = {}): Finding {
  return {
    id: 'f-1',
    site_id: SITE,
    origin: 'inspection',
    state: 'raised',
    inspection_id: 'insp-1',
    template_version_item_id: 'tvi-1',
    item_key: 'exits.clear',
    location_id: null,
    description: 'The east exit was blocked by pallets.',
    photo_object_keys: [],
    reported_by: '11111111-1111-4111-8111-111111111111',
    occurred_at: '2027-07-29T18:00:00.000Z',
    recorded_at: '2027-07-29T18:05:00.000Z',
    ...overrides,
  } as Finding;
}

describe('inspectionsWithFindings', () => {
  it('conserva una inspección una sola vez aunque su envío tenga varios hallazgos', () => {
    const rows = inspectionsWithFindings(
      [scheduled()],
      [finding(), finding({ id: 'f-2' }), finding({ id: 'f-3' })],
    );

    expect(rows.map((row) => row.id)).toEqual(['s-1']);
  });

  it('esconde una inspección limpia', () => {
    expect(
      inspectionsWithFindings(
        [scheduled({ inspection_id: 'insp-clean' })],
        [finding()],
      ),
    ).toEqual([]);
  });

  it('cruza por el id del envío y no por la inspección programada', () => {
    expect(
      inspectionsWithFindings(
        [scheduled({ id: 'insp-9', inspection_id: 'insp-1' })],
        [finding({ inspection_id: 'insp-9' })],
      ),
    ).toEqual([]);
  });

  it('ignora hallazgos manuales y filas sin envío visible', () => {
    const manual = finding({ origin: 'manual', inspection_id: null, item_key: null });

    expect(inspectionsWithFindings([scheduled()], [manual])).toEqual([]);
    expect(inspectionsWithFindings([scheduled({ inspection_id: null })], [finding()])).toEqual([]);
  });

  it('conserva el orden recibido', () => {
    const rows = inspectionsWithFindings(
      [
        scheduled({ id: 'july', inspection_id: 'insp-july' }),
        scheduled({ id: 'may', inspection_id: 'insp-may' }),
      ],
      [finding({ inspection_id: 'insp-may' }), finding({ id: 'f-2', inspection_id: 'insp-july' })],
    );

    expect(rows.map((row) => row.id)).toEqual(['july', 'may']);
  });
});
