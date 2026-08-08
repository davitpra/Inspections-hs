import { describe, expect, it } from 'vitest';

import { templateDocumentSchema, type TemplateDocument } from './schema.js';
import { validateAnswers, type ViolationCode } from './validate.js';

/**
 * Un documento con un ítem de cada tipo que la validación necesita ejercitar,
 * más el par condicional `hazard.present` / `hazard.followup`.
 */
function document(): TemplateDocument {
  return templateDocumentSchema.parse({
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'guards.present',
            prompt: 'Machine guards present?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
          {
            item_key: 'housekeeping.score',
            prompt: 'Housekeeping score',
            position: 2,
            required: true,
            response_type: 'scale',
            min: 1,
            max: 5,
          },
          {
            item_key: 'temperature.reading',
            prompt: 'Cooler temperature',
            position: 3,
            required: false,
            response_type: 'number',
            min: -10,
            max: 40,
            decimals: 1,
          },
          {
            item_key: 'notes.general',
            prompt: 'Notes',
            position: 4,
            required: false,
            response_type: 'text',
            max_length: 20,
          },
          {
            item_key: 'ppe.worn',
            prompt: 'PPE worn',
            position: 5,
            required: false,
            response_type: 'multi_choice',
            options: [
              { value: 'gloves', label: 'Gloves' },
              { value: 'goggles', label: 'Goggles' },
              { value: 'boots', label: 'Boots' },
            ],
            min_selected: 1,
            max_selected: 2,
          },
        ],
      },
      {
        section_key: 'hazards',
        section_title: 'Hazards',
        position: 2,
        items: [
          {
            item_key: 'hazard.present',
            prompt: 'Any hazard observed?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
          {
            item_key: 'hazard.followup',
            prompt: 'Describe the hazard',
            position: 2,
            required: true,
            response_type: 'text',
            max_length: 500,
            visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
          },
        ],
      },
    ],
  });
}

/** Las respuestas mínimas que hacen válido el documento de arriba. */
function validAnswers(): Record<string, unknown> {
  return {
    'guards.present': true,
    'housekeeping.score': 4,
    'hazard.present': false,
  };
}

/** Los códigos devueltos, por `item_key`. */
function codesOf(answers: Record<string, unknown>): Record<string, ViolationCode[]> {
  const result = validateAnswers(document(), answers);

  if (result.ok) return {};

  const byItem: Record<string, ViolationCode[]> = {};

  for (const violation of result.violations) {
    (byItem[violation.item_key] ??= []).push(violation.code);
  }

  return byItem;
}

describe('validateAnswers', () => {
  it('acepta un conjunto de respuestas válido', () => {
    expect(validateAnswers(document(), validAnswers())).toEqual({ ok: true });
  });

  it('acepta un ítem visible y opcional sin contestar', () => {
    const answers = validAnswers();
    delete answers['notes.general'];

    expect(validateAnswers(document(), answers).ok).toBe(true);
  });

  it('reporta un requerido visible sin contestar', () => {
    const answers = validAnswers();
    delete answers['housekeeping.score'];

    expect(codesOf(answers)['housekeeping.score']).toEqual(['required_missing']);
  });

  it('reporta todas las violaciones de una sola vez', () => {
    const result = validateAnswers(document(), {
      'guards.present': 'yes',
      'housekeeping.score': 7,
      'hazard.present': false,
      'notes.general': 'x'.repeat(50),
    });

    expect(result.ok).toBe(false);

    if (result.ok) return;

    expect(result.violations.map((violation) => violation.item_key).sort()).toEqual([
      'guards.present',
      'housekeeping.score',
      'notes.general',
    ]);
  });

  it('reporta una scale fuera de rango', () => {
    const answers = { ...validAnswers(), 'housekeeping.score': 7 };

    expect(codesOf(answers)['housekeeping.score']).toEqual(['out_of_range']);
  });

  it('reporta un number con más decimales de los declarados', () => {
    const answers = { ...validAnswers(), 'temperature.reading': 3.456 };

    expect(codesOf(answers)['temperature.reading']).toEqual(['too_many_decimals']);
  });

  it('reporta un texto más largo que max_length', () => {
    const answers = { ...validAnswers(), 'notes.general': 'x'.repeat(21) };

    expect(codesOf(answers)['notes.general']).toEqual(['too_long']);
  });

  it('reporta una opción que no está en el catálogo del ítem', () => {
    const answers = { ...validAnswers(), 'ppe.worn': ['gloves', 'hard-hat'] };

    expect(codesOf(answers)['ppe.worn']).toEqual(['unknown_option']);
  });

  it('reporta una opción repetida', () => {
    const answers = { ...validAnswers(), 'ppe.worn': ['gloves', 'gloves'] };

    expect(codesOf(answers)['ppe.worn']).toEqual(['duplicate_option']);
  });

  it('reporta más selecciones que las permitidas', () => {
    const answers = { ...validAnswers(), 'ppe.worn': ['gloves', 'goggles', 'boots'] };

    expect(codesOf(answers)['ppe.worn']).toEqual(['selection_count_out_of_range']);
  });

  it('reporta una respuesta con la forma equivocada', () => {
    const answers = { ...validAnswers(), 'guards.present': 'yes' };

    expect(codesOf(answers)['guards.present']).toEqual(['wrong_shape']);
  });

  it('reporta una respuesta para una item_key que el documento no contiene', () => {
    const answers = { ...validAnswers(), 'lockout.tags-present': true };

    expect(codesOf(answers)['lockout.tags-present']).toEqual(['unknown_item']);
  });

  it('reporta una respuesta para un ítem oculto', () => {
    const answers = { ...validAnswers(), 'hazard.followup': 'Spill near line 3' };

    expect(codesOf(answers)['hazard.followup']).toEqual(['answer_for_hidden_item']);
  });

  it('exige el requerido condicional cuando la condición se cumple', () => {
    const answers = { ...validAnswers(), 'hazard.present': true };

    expect(codesOf(answers)['hazard.followup']).toEqual(['required_missing']);
  });

  it('no exige un requerido que queda dentro de una sección oculta', () => {
    const doc = templateDocumentSchema.parse({
      sections: [
        {
          section_key: 'hazards',
          section_title: 'Hazards',
          position: 1,
          items: [
            {
              item_key: 'hazard.present',
              prompt: 'Any hazard observed?',
              position: 1,
              required: true,
              response_type: 'yes_no',
            },
          ],
        },
        {
          section_key: 'followup',
          section_title: 'Follow-up',
          position: 2,
          visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
          items: [
            {
              item_key: 'followup.owner',
              prompt: 'Who owns the follow-up?',
              position: 1,
              required: true,
              response_type: 'text',
              max_length: 120,
            },
          ],
        },
      ],
    });

    expect(validateAnswers(doc, { 'hazard.present': false }).ok).toBe(true);
  });

  it('acepta las respuestas de foto y firma como object keys', () => {
    const doc = templateDocumentSchema.parse({
      sections: [
        {
          section_key: 'closeout',
          section_title: 'Close-out',
          position: 1,
          items: [
            {
              item_key: 'evidence.photos',
              prompt: 'Photos',
              position: 1,
              required: true,
              response_type: 'photo',
              min_count: 1,
              max_count: 2,
            },
            {
              item_key: 'closeout.signature',
              prompt: 'Inspector signature',
              position: 2,
              required: true,
              response_type: 'signature',
            },
          ],
        },
      ],
    });

    expect(
      validateAnswers(doc, {
        'evidence.photos': ['site/a.jpg'],
        'closeout.signature': { object_key: 'site/sig.png', signed_at: '2026-08-08T14:00:00.000Z' },
      }).ok,
    ).toBe(true);

    const tooMany = validateAnswers(doc, {
      'evidence.photos': ['a.jpg', 'b.jpg', 'c.jpg'],
      'closeout.signature': { object_key: 'site/sig.png', signed_at: '2026-08-08T14:00:00.000Z' },
    });

    expect(tooMany.ok).toBe(false);

    if (tooMany.ok) return;

    expect(tooMany.violations[0]?.code).toBe('photo_count_out_of_range');
  });

  it('es determinista: dos corridas con la misma entrada dan el mismo resultado', () => {
    const answers = { ...validAnswers(), 'housekeeping.score': 9 };

    expect(validateAnswers(document(), answers)).toEqual(validateAnswers(document(), answers));
  });
});
