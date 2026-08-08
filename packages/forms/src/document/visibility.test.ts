import { describe, expect, it } from 'vitest';

import { templateDocumentSchema, type TemplateDocument } from './schema.js';
import { evaluateVisibility } from './visibility.js';

/**
 * `hazard.present` (sí/no) y `hazard.followup`, que solo se muestra cuando el
 * primero es `true`. Es la forma que tiene toda lógica condicional de v1.
 */
function document(): TemplateDocument {
  return templateDocumentSchema.parse({
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

function errors(input: unknown): string {
  const result = templateDocumentSchema.safeParse(input);

  if (result.success) {
    throw new Error('Se esperaba que el documento fuera rechazado.');
  }

  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
}

describe('evaluateVisibility', () => {
  it('muestra el ítem cuando su condición se cumple', () => {
    const visibility = evaluateVisibility(document(), { 'hazard.present': true });

    expect(visibility['hazard.followup']).toBe(true);
  });

  it('oculta el ítem cuando el ítem fuente no está contestado', () => {
    const visibility = evaluateVisibility(document(), {});

    expect(visibility['hazard.present']).toBe(true);
    expect(visibility['hazard.followup']).toBe(false);
  });

  it('oculta el ítem cuando la condición no se cumple', () => {
    const visibility = evaluateVisibility(document(), { 'hazard.present': false });

    expect(visibility['hazard.followup']).toBe(false);
  });

  it('una sección oculta oculta todos sus ítems, aunque el ítem se muestre por su cuenta', () => {
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

    expect(evaluateVisibility(doc, { 'hazard.present': false })['followup.owner']).toBe(false);
    expect(evaluateVisibility(doc, { 'hazard.present': true })['followup.owner']).toBe(true);
  });

  it('la respuesta de un ítem oculto no arrastra visibilidad a un tercero', () => {
    const doc = templateDocumentSchema.parse({
      sections: [
        {
          section_key: 'chain',
          section_title: 'Chain',
          position: 1,
          items: [
            {
              item_key: 'a',
              prompt: 'A?',
              position: 1,
              required: true,
              response_type: 'yes_no',
            },
            {
              item_key: 'b',
              prompt: 'B?',
              position: 2,
              required: true,
              response_type: 'yes_no',
              visible_when: { item_key: 'a', operator: 'equals', value: true },
            },
            {
              item_key: 'c',
              prompt: 'C?',
              position: 3,
              required: true,
              response_type: 'yes_no',
              visible_when: { item_key: 'b', operator: 'equals', value: true },
            },
          ],
        },
      ],
    });

    // `b` está oculto porque `a` es false, así que su respuesta no cuenta y `c`
    // queda oculto también.
    const visibility = evaluateVisibility(doc, { a: false, b: true });

    expect(visibility.b).toBe(false);
    expect(visibility.c).toBe(false);
  });

  it('evalúa all_of y any_of', () => {
    const doc = templateDocumentSchema.parse({
      sections: [
        {
          section_key: 'ppe',
          section_title: 'PPE',
          position: 1,
          items: [
            {
              item_key: 'ppe.worn',
              prompt: 'PPE worn?',
              position: 1,
              required: true,
              response_type: 'yes_no',
            },
            {
              item_key: 'ppe.score',
              prompt: 'PPE score',
              position: 2,
              required: true,
              response_type: 'scale',
              min: 1,
              max: 5,
            },
            {
              item_key: 'ppe.all',
              prompt: 'Both conditions',
              position: 3,
              required: false,
              response_type: 'text',
              max_length: 50,
              visible_when: {
                all_of: [
                  { item_key: 'ppe.worn', operator: 'equals', value: true },
                  { item_key: 'ppe.score', operator: 'lte', value: 2 },
                ],
              },
            },
            {
              item_key: 'ppe.any',
              prompt: 'Either condition',
              position: 4,
              required: false,
              response_type: 'text',
              max_length: 50,
              visible_when: {
                any_of: [
                  { item_key: 'ppe.worn', operator: 'equals', value: false },
                  { item_key: 'ppe.score', operator: 'gte', value: 4 },
                ],
              },
            },
          ],
        },
      ],
    });

    const visibility = evaluateVisibility(doc, { 'ppe.worn': true, 'ppe.score': 2 });

    expect(visibility['ppe.all']).toBe(true);
    expect(visibility['ppe.any']).toBe(false);
  });
});

describe('referencias de visible_when', () => {
  it('rechaza una referencia hacia adelante', () => {
    const doc = document();
    doc.sections[0]!.items[0]!.visible_when = {
      item_key: 'hazard.followup',
      operator: 'answered',
    };

    const message = errors(doc);

    expect(message).toContain('hazard.present');
    expect(message).toContain('hazard.followup');
  });

  it('rechaza una referencia a una item_key que el documento no contiene', () => {
    const doc = document();
    doc.sections[0]!.items[1]!.visible_when = {
      item_key: 'lockout.tags-present',
      operator: 'answered',
    };

    expect(errors(doc)).toContain('lockout.tags-present');
  });

  it('rechaza que un ítem se referencie a sí mismo', () => {
    const doc = document();
    doc.sections[0]!.items[1]!.visible_when = {
      item_key: 'hazard.followup',
      operator: 'answered',
    };

    expect(errors(doc)).toContain('hazard.followup');
  });

  it('rechaza que una sección referencie un ítem propio o posterior', () => {
    const doc = document();
    doc.sections[0]!.visible_when = { item_key: 'hazard.present', operator: 'answered' };

    expect(errors(doc)).toContain('hazards');
  });
});
