import { describe, expect, it } from 'vitest';

import type { FindingDetails } from '@hs/contracts';
import { templateDocumentSchema, type TemplateDocument } from '@hs/forms';

import { deriveFindings, findingObjectKeys } from './derive';

const LOCATION_ID = '11111111-1111-4111-8111-111111111111';

function details(overrides: Partial<FindingDetails> = {}): FindingDetails {
  return {
    description: 'Guard missing on the infeed of packaging line 3',
    location_id: LOCATION_ID,
    photo_object_keys: ['site/inspection/aaa.jpg'],
    ...overrides,
  };
}

function document(items: Record<string, unknown>[]): TemplateDocument {
  return templateDocumentSchema.parse({
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: items.map((item, index) => ({ position: index + 1, ...item })),
      },
    ],
  });
}

const guards = {
  item_key: 'guards.present',
  prompt: 'Guards?',
  required: true,
  response_type: 'yes_no',
};

const eyewash = {
  item_key: 'eyewash.tested',
  prompt: 'Eyewash flushed?',
  required: true,
  response_type: 'yes_no_na',
};

describe('deriveFindings', () => {
  it('deriva un hallazgo por respuesta negativa', () => {
    const result = deriveFindings(
      document([guards]),
      { 'guards.present': false },
      { 'guards.present': details() },
    );

    expect(result).toEqual({
      ok: true,
      findings: [{ item_key: 'guards.present', details: details() }],
    });
  });

  it('un envío sin negativos no deriva nada y no falla', () => {
    const result = deriveFindings(document([guards]), { 'guards.present': true }, {});

    expect(result).toEqual({ ok: true, findings: [] });
  });

  it('una respuesta negativa sin detalles es finding_missing', () => {
    const result = deriveFindings(document([guards]), { 'guards.present': false }, {});

    expect(result).toEqual({
      ok: false,
      violations: [{ item_key: 'guards.present', code: 'finding_missing' }],
    });
  });

  it('detalles para una respuesta afirmativa son unexpected_finding', () => {
    const result = deriveFindings(
      document([guards]),
      { 'guards.present': true },
      { 'guards.present': details() },
    );

    expect(result).toEqual({
      ok: false,
      violations: [{ item_key: 'guards.present', code: 'unexpected_finding' }],
    });
  });

  /** `na` no es un incumplimiento: pedirle detalles sería pedir un hallazgo inventado. */
  it('detalles para un na son unexpected_finding', () => {
    const result = deriveFindings(
      document([eyewash]),
      { 'eyewash.tested': 'na' },
      { 'eyewash.tested': details() },
    );

    expect(result).toEqual({
      ok: false,
      violations: [{ item_key: 'eyewash.tested', code: 'unexpected_finding' }],
    });
  });

  it('detalles para una item_key que el documento no contiene son unexpected_finding', () => {
    const result = deriveFindings(
      document([guards]),
      { 'guards.present': true },
      { 'ghost.item': details() },
    );

    expect(result).toEqual({
      ok: false,
      violations: [{ item_key: 'ghost.item', code: 'unexpected_finding' }],
    });
  });

  it('detalles para un ítem oculto son unexpected_finding', () => {
    const conditional = document([
      guards,
      {
        item_key: 'guards.replaced',
        prompt: 'Replaced?',
        required: true,
        response_type: 'yes_no',
        visible_when: {
          item_key: 'guards.present',
          operator: 'equals',
          value: true,
        },
      },
    ]);

    const result = deriveFindings(
      conditional,
      { 'guards.present': false, 'guards.replaced': false },
      { 'guards.present': details(), 'guards.replaced': details() },
    );

    expect(result).toEqual({
      ok: false,
      violations: [{ item_key: 'guards.replaced', code: 'unexpected_finding' }],
    });
  });

  it('reporta las faltantes y las sobrantes de un mismo envío juntas', () => {
    const result = deriveFindings(
      document([guards, eyewash]),
      { 'guards.present': false, 'eyewash.tested': 'yes' },
      { 'eyewash.tested': details() },
    );

    expect(result).toEqual({
      ok: false,
      violations: [
        { item_key: 'guards.present', code: 'finding_missing' },
        { item_key: 'eyewash.tested', code: 'unexpected_finding' },
      ],
    });
  });

  it('deriva en orden de documento', () => {
    const result = deriveFindings(
      document([guards, eyewash]),
      { 'guards.present': false, 'eyewash.tested': 'no' },
      { 'eyewash.tested': details(), 'guards.present': details() },
    );

    expect(result.ok).toBe(true);
    expect(result.ok && result.findings.map((finding) => finding.item_key)).toEqual([
      'guards.present',
      'eyewash.tested',
    ]);
  });
});

describe('findingObjectKeys', () => {
  it('junta las keys de todos los hallazgos', () => {
    const keys = findingObjectKeys({
      'guards.present': details({ photo_object_keys: ['a.jpg', 'b.jpg'] }),
      'eyewash.tested': details({ photo_object_keys: ['c.jpg'] }),
    });

    expect(keys).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
  });

  it('un bloque vacío no aporta keys', () => {
    expect(findingObjectKeys({})).toEqual([]);
  });
});
