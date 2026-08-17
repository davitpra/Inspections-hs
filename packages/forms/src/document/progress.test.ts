import { describe, expect, it } from 'vitest';

import { templateDocumentSchema, type TemplateDocument } from './schema.js';
import { countAnswered, countAnsweredBySection } from './progress.js';

/** `hazard.followup` solo se muestra cuando `hazard.present` es `true`. */
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
      {
        section_key: 'ppe',
        section_title: 'PPE',
        position: 2,
        items: [
          {
            item_key: 'ppe.worn',
            prompt: 'PPE worn?',
            position: 1,
            required: true,
            response_type: 'yes_no',
          },
        ],
      },
    ],
  });
}

describe('el conteo de respondidos', () => {
  it('no cuenta lo que nadie contestó todavía', () => {
    expect(countAnswered(document(), {})).toBe(0);
  });

  /**
   * El caso que hace que el número sirva: con `false` el ítem condicional no está en
   * pantalla, así que "1 answered" es la recorrida entera y no una a medias.
   */
  it('ignora los ítems que una respuesta anterior dejó ocultos', () => {
    expect(countAnswered(document(), { 'hazard.present': false })).toBe(1);
  });

  it('cuenta el condicional una vez que se volvió visible y se contestó', () => {
    const answers = { 'hazard.present': true, 'hazard.followup': 'Open guard on line 3' };

    expect(countAnswered(document(), answers)).toBe(2);
  });

  /** Un valor visible pero sin contestar no suma: `undefined` es no contestado. */
  it('un ítem visible sin respuesta no suma', () => {
    expect(countAnswered(document(), { 'hazard.present': true })).toBe(1);
  });
});

describe('el conteo por sección', () => {
  it('una sección por entrada, en orden de documento', () => {
    const result = countAnsweredBySection(document(), {});

    expect(result.map((entry) => entry.section_key)).toEqual(['hazards', 'ppe']);
  });

  it('el total de una sección baja cuando un ítem condicional queda oculto', () => {
    const result = countAnsweredBySection(document(), { 'hazard.present': false });

    expect(result[0]).toMatchObject({ section_key: 'hazards', answered: 1, total: 1 });
  });

  it('el total sube cuando el condicional se vuelve visible', () => {
    const result = countAnsweredBySection(document(), { 'hazard.present': true });

    expect(result[0]).toMatchObject({ section_key: 'hazards', answered: 1, total: 2 });
  });
});
