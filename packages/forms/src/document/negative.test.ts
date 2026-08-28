import { describe, expect, it } from 'vitest';

import { negativeAnswers } from './negative.js';
import { RESPONSE_TYPES, templateDocumentSchema, type TemplateDocument } from './schema.js';

/**
 * La regla de la etapa 4, sin base y sin red.
 *
 * La tabla compartida de `@hs/forms/testing` prueba que el servidor deriva lo
 * mismo (`expected_negative`). Acá se cubre la regla por tipo de respuesta, que
 * es donde puede romperse en silencio: un tipo nuevo que empiece a derivar sin
 * decisión sería exactamente el riesgo A visto desde el otro lado —hallazgos que
 * aparecen sin que nadie los haya pedido.
 */

function parse(items: Record<string, unknown>[]): TemplateDocument {
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

const yesNo = { item_key: 'guards.present', prompt: 'Guards?', required: true, response_type: 'yes_no' };
const yesNoNa = {
  item_key: 'eyewash.tested',
  prompt: 'Eyewash flushed?',
  required: true,
  response_type: 'yes_no_na',
};

describe('negativeAnswers', () => {
  it('deriva de un yes_no en false', () => {
    expect(negativeAnswers(parse([yesNo]), { 'guards.present': false })).toEqual([
      'guards.present',
    ]);
  });

  it('no deriva de un yes_no en true', () => {
    expect(negativeAnswers(parse([yesNo]), { 'guards.present': true })).toEqual([]);
  });

  it('no deriva de un yes_no sin contestar', () => {
    expect(negativeAnswers(parse([yesNo]), {})).toEqual([]);
  });

  it('con fails_on: "yes", deriva del "Sí" y no del "No"', () => {
    const invertedYesNo = { ...yesNo, fails_on: 'yes' as const };

    expect(negativeAnswers(parse([invertedYesNo]), { 'guards.present': true })).toEqual([
      'guards.present',
    ]);
    expect(negativeAnswers(parse([invertedYesNo]), { 'guards.present': false })).toEqual([]);
  });

  it.each([
    ['no', ['eyewash.tested']],
    ['yes', []],
    ['na', []],
  ] as const)('yes_no_na en %s deriva %j', (answer, expected) => {
    expect(negativeAnswers(parse([yesNoNa]), { 'eyewash.tested': answer })).toEqual(expected);
  });

  it('con el modo por defecto ("no"), na no es un incumplimiento aunque el ítem sea required', () => {
    expect(negativeAnswers(parse([yesNoNa]), { 'eyewash.tested': 'na' })).toEqual([]);
  });

  it('con fails_on: "yes", yes_no_na deriva del "Sí" y "na" sigue sin ser un incumplimiento', () => {
    const invertedYesNoNa = { ...yesNoNa, fails_on: 'yes' as const };

    expect(negativeAnswers(parse([invertedYesNoNa]), { 'eyewash.tested': 'yes' })).toEqual([
      'eyewash.tested',
    ]);
    expect(negativeAnswers(parse([invertedYesNoNa]), { 'eyewash.tested': 'no' })).toEqual([]);
    expect(negativeAnswers(parse([invertedYesNoNa]), { 'eyewash.tested': 'na' })).toEqual([]);
  });

  it.each([
    ['no_na', 'no', ['eyewash.tested']],
    ['no_na', 'na', ['eyewash.tested']],
    ['no_na', 'yes', []],
    ['na', 'na', ['eyewash.tested']],
    ['na', 'no', []],
    ['na', 'yes', []],
    ['yes_na', 'yes', ['eyewash.tested']],
    ['yes_na', 'na', ['eyewash.tested']],
    ['yes_na', 'no', []],
  ] as const)('con fails_on: "%s", la respuesta "%s" deriva %j', (failsOn, answer, expected) => {
    const item = { ...yesNoNa, fails_on: failsOn };

    expect(negativeAnswers(parse([item]), { 'eyewash.tested': answer })).toEqual(expected);
  });

  /**
   * El caso que sostiene la decisión D2: ningún otro tipo deriva. Si alguien
   * agrega un `response_type` y quiere que derive, este test lo obliga a
   * declararlo — que es el punto.
   */
  it.each([
    [{ item_key: 'a.scale', prompt: 'p', required: true, response_type: 'scale', min: 1, max: 5 }, 1],
    [
      { item_key: 'a.text', prompt: 'p', required: true, response_type: 'text', max_length: 20 },
      'nothing works',
    ],
    [
      {
        item_key: 'a.number',
        prompt: 'p',
        required: true,
        response_type: 'number',
        min: -10,
        max: 40,
        decimals: 0,
      },
      -10,
    ],
    [
      {
        item_key: 'a.single',
        prompt: 'p',
        required: true,
        response_type: 'single_choice',
        options: [{ value: 'no', label: 'No' }],
      },
      'no',
    ],
    [
      {
        item_key: 'a.multi',
        prompt: 'p',
        required: true,
        response_type: 'multi_choice',
        options: [{ value: 'none', label: 'None' }],
        min_selected: 1,
        max_selected: 1,
      },
      ['none'],
    ],
    [
      {
        item_key: 'a.photo',
        prompt: 'p',
        required: true,
        response_type: 'photo',
        min_count: 1,
        max_count: 2,
      },
      ['inspections/a.jpg'],
    ],
    [
      { item_key: 'a.signature', prompt: 'p', required: true, response_type: 'signature' },
      { object_key: 'inspections/sig.png', signed_at: '2026-08-08T14:00:00.000Z' },
    ],
  ])('no deriva de %j', (item, answer) => {
    const document = parse([item as Record<string, unknown>]);
    const itemKey = (item as { item_key: string }).item_key;

    expect(negativeAnswers(document, { [itemKey]: answer })).toEqual([]);
  });

  it('cubre los nueve tipos de respuesta entre los casos de arriba', () => {
    // Dos derivan (`yes_no`, `yes_no_na`) y los otros siete están en la tabla.
    expect(RESPONSE_TYPES).toHaveLength(9);
  });

  it('no deriva de un ítem oculto aunque traiga respuesta negativa', () => {
    const document = parse([
      { item_key: 'hazard.present', prompt: 'Hazard?', required: true, response_type: 'yes_no' },
      {
        item_key: 'hazard.contained',
        prompt: 'Contained?',
        required: true,
        response_type: 'yes_no',
        visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
      },
    ]);

    expect(
      negativeAnswers(document, { 'hazard.present': false, 'hazard.contained': false }),
    ).toEqual(['hazard.present']);
  });

  it('no deriva de una item_key que el documento no contiene', () => {
    expect(negativeAnswers(parse([yesNo]), { 'guards.present': true, 'ghost.item': false })).toEqual(
      [],
    );
  });

  it('devuelve los negativos en orden de documento', () => {
    const document = parse([yesNo, yesNoNa]);

    expect(
      negativeAnswers(document, { 'guards.present': false, 'eyewash.tested': 'no' }),
    ).toEqual(['guards.present', 'eyewash.tested']);
  });

  it('un conjunto de respuestas sin negativos devuelve una lista vacía', () => {
    expect(negativeAnswers(parse([yesNo, yesNoNa]), {
      'guards.present': true,
      'eyewash.tested': 'yes',
    })).toEqual([]);
  });
});
