import { describe, expect, it } from 'vitest';

import { findingSchema, manualFindingRequestSchema } from './findings.js';

const SITE_ID = '11111111-1111-4111-8111-111111111111';
const DRAFT_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const FINDING_ID = '55555555-5555-4555-8555-555555555555';

function validDetails() {
  return {
    description: 'Guard missing on the infeed of packaging line 3',
    location_id: LOCATION_ID,
    photo_object_keys: ['site/manual/draft/aaa.jpg'],
  };
}

function validManual() {
  return {
    site_id: SITE_ID,
    draft_finding_id: DRAFT_ID,
    details: validDetails(),
    occurred_at: '2026-08-10T13:00:00.000Z',
  };
}

describe('manualFindingRequestSchema', () => {
  it('acepta un hallazgo manual', () => {
    expect(manualFindingRequestSchema.safeParse(validManual()).success).toBe(true);
  });

  /** El hallazgo ya no se clasifica (ADR-014): un cliente viejo se rechaza, no se ignora. */
  it('rechaza una clasificación', () => {
    const result = manualFindingRequestSchema.safeParse({
      ...validManual(),
      classification: { probability: 'possible', severity: 'moderate', control_level: 'engineering' },
    });

    expect(result.success).toBe(false);
  });

  /** Un hallazgo manual no tiene ítem (§5 riesgo F). */
  it('rechaza una item_key', () => {
    const result = manualFindingRequestSchema.safeParse({
      ...validManual(),
      item_key: 'guarding.installed',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza un hallazgo sin foto', () => {
    const result = manualFindingRequestSchema.safeParse({
      ...validManual(),
      details: { ...validDetails(), photo_object_keys: [] },
    });

    expect(result.success).toBe(false);
  });
});

describe('findingSchema', () => {
  function derived() {
    return {
      id: FINDING_ID,
      site_id: SITE_ID,
      origin: 'inspection',
      inspection_id: '66666666-6666-4666-8666-666666666666',
      template_version_item_id: '77777777-7777-4777-8777-777777777777',
      item_key: 'guarding.installed',
      location_id: LOCATION_ID,
      description: 'Guard missing on the infeed of packaging line 3',
      photo_object_keys: ['site/inspection/aaa.jpg'],
      reported_by: USER_ID,
      occurred_at: '2026-08-03T14:20:00.000Z',
      recorded_at: '2026-08-09T09:00:00.000Z',
    };
  }

  it('acepta un hallazgo derivado', () => {
    expect(findingSchema.safeParse(derived()).success).toBe(true);
  });

  /** La clasificación se retiró (ADR-014) y el objeto es estricto. */
  it('no admite una clasificación', () => {
    const result = findingSchema.safeParse({ ...derived(), assessment: null });

    expect(result.success).toBe(false);
  });

  it('acepta un hallazgo manual con la identidad dual en null', () => {
    const result = findingSchema.safeParse({
      ...derived(),
      origin: 'manual',
      inspection_id: null,
      template_version_item_id: null,
      item_key: null,
    });

    expect(result.success).toBe(true);
  });

  /** La marca de recurrencia se retiró (ADR-015) y el objeto es estricto. */
  it('no admite una marca de recurrencia', () => {
    const result = findingSchema.safeParse({ ...derived(), recurrence: null });

    expect(result.success).toBe(false);
  });

  it('no admite un campo status', () => {
    const result = findingSchema.safeParse({ ...derived(), status: 'open' });

    expect(result.success).toBe(false);
  });
});
