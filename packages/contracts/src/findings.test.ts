import { describe, expect, it } from 'vitest';

import {
  CONTROL_LEVELS,
  PROBABILITIES,
  RISK_LEVELS,
  SEVERITIES,
  findingSchema,
  manualFindingRequestSchema,
  riskAssessmentRequestSchema,
} from './findings.js';

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
    classification: {
      probability: 'possible',
      severity: 'moderate',
      control_level: 'engineering',
    },
  };
}

describe('las escalas', () => {
  it('tienen el tamaño que la matriz asume', () => {
    expect(PROBABILITIES).toHaveLength(5);
    expect(SEVERITIES).toHaveLength(5);
    expect(RISK_LEVELS).toHaveLength(4);
    expect(CONTROL_LEVELS).toHaveLength(5);
  });

  /**
   * El orden es el índice 1..5 de la matriz. Reordenarlas cambiaría en silencio
   * el nivel de riesgo de todo lo que se clasifique después.
   */
  it('están ordenadas de menor a mayor', () => {
    expect(PROBABILITIES[0]).toBe('rare');
    expect(PROBABILITIES[4]).toBe('almost_certain');
    expect(SEVERITIES[0]).toBe('negligible');
    expect(SEVERITIES[4]).toBe('catastrophic');
  });

  /** La jerarquía de controles va de la más efectiva a la menos (R2). */
  it('la jerarquía de controles arranca en eliminación y termina en EPP', () => {
    expect(CONTROL_LEVELS[0]).toBe('elimination');
    expect(CONTROL_LEVELS[4]).toBe('ppe');
  });
});

describe('riskAssessmentRequestSchema', () => {
  it('acepta una clasificación sin motivo', () => {
    const result = riskAssessmentRequestSchema.safeParse({
      probability: 'likely',
      severity: 'major',
      control_level: 'ppe',
    });

    expect(result.success).toBe(true);
  });

  /** D5 — el nivel lo calcula el motor. El `strictObject` es la primera barrera. */
  it('rechaza un risk_level propuesto por el caller', () => {
    const result = riskAssessmentRequestSchema.safeParse({
      probability: 'likely',
      severity: 'major',
      control_level: 'ppe',
      risk_level: 'low',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una severidad fuera de la lista', () => {
    const result = riskAssessmentRequestSchema.safeParse({
      probability: 'likely',
      severity: 'fatal',
      control_level: 'ppe',
    });

    expect(result.success).toBe(false);
  });

  it('rechaza una clasificación sin nivel de control', () => {
    const result = riskAssessmentRequestSchema.safeParse({
      probability: 'likely',
      severity: 'major',
    });

    expect(result.success).toBe(false);
  });
});

describe('manualFindingRequestSchema', () => {
  it('acepta un hallazgo manual con su clasificación inicial', () => {
    expect(manualFindingRequestSchema.safeParse(validManual()).success).toBe(true);
  });

  /** La primera clasificación no lleva motivo: el `CHECK` de 0010 dice lo mismo. */
  it('rechaza un motivo en la clasificación inicial', () => {
    const request = validManual();
    const result = manualFindingRequestSchema.safeParse({
      ...request,
      classification: { ...request.classification, reason: 'porque sí, y con largo suficiente' },
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
      assessment: null,
    };
  }

  /** D10 — sin clasificar es `assessment: null`, no un `status`. */
  it('acepta un hallazgo derivado sin clasificar', () => {
    expect(findingSchema.safeParse(derived()).success).toBe(true);
  });

  it('acepta un hallazgo con su clasificación vigente', () => {
    const result = findingSchema.safeParse({
      ...derived(),
      assessment: {
        id: '88888888-8888-4888-8888-888888888888',
        probability: 'possible',
        severity: 'moderate',
        risk_level: 'medium',
        control_level: 'engineering',
        reason: null,
        supersedes_id: null,
        assessed_by: USER_ID,
        assessed_at: '2026-08-10T10:00:00.000Z',
      },
    });

    expect(result.success).toBe(true);
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

  it('no admite un campo status', () => {
    const result = findingSchema.safeParse({ ...derived(), status: 'unclassified' });

    expect(result.success).toBe(false);
  });
});
