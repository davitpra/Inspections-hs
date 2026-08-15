import { describe, expect, it } from 'vitest';
import { templateDocumentSchema, type TemplateDocument } from '@hs/forms';

import { countAnswered } from './presentation';

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
