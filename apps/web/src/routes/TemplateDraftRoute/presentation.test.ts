import type { TemplateDraftDocument } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import { hasUnsavedChanges, saveButtonLabel, saveErrorNotice, totalItems } from './presentation';

function document(): TemplateDraftDocument {
  return {
    sections: [
      {
        section_key: 'a',
        section_title: 'A',
        items: [
          { item_key: 'one', prompt: 'One', required: true, response_type: 'yes_no' },
          { item_key: 'two', prompt: 'Two', required: true, response_type: 'yes_no' },
        ],
      },
      { section_key: 'b', section_title: 'B', items: [] },
    ],
  };
}

describe('totalItems', () => {
  it('cuenta las preguntas de todas las secciones', () => {
    expect(totalItems(document())).toBe(2);
  });

  it('un documento vacío no tiene ninguna', () => {
    expect(totalItems({ sections: [] })).toBe(0);
  });
});

describe('hasUnsavedChanges', () => {
  it('no hay cambios cuando el documento y el nombre son los mismos', () => {
    expect(hasUnsavedChanges(document(), document(), 'Name', 'Name')).toBe(false);
  });

  it('detecta un cambio en el documento', () => {
    const edited = document();
    edited.sections[0]!.section_title = 'Changed';

    expect(hasUnsavedChanges(edited, document(), 'Name', 'Name')).toBe(true);
  });

  it('detecta un cambio solo en el nombre', () => {
    expect(hasUnsavedChanges(document(), document(), 'Renamed', 'Name')).toBe(true);
  });

  /**
   * La razón de comparar en vez de llevar un flag: deshacer a mano lo que se acababa de
   * escribir tiene que volver a "guardado", y un `dirty` booleano se quedaría en `true`.
   */
  it('deshacer a mano vuelve a "sin cambios"', () => {
    const edited = document();
    edited.sections[0]!.section_title = 'Changed';
    edited.sections[0]!.section_title = 'A';

    expect(hasUnsavedChanges(edited, document(), 'Name', 'Name')).toBe(false);
  });
});

describe('saveButtonLabel', () => {
  it('dice en qué está', () => {
    expect(saveButtonLabel(true, true)).toBe('Saving…');
    expect(saveButtonLabel(false, true)).toBe('Save draft');
    expect(saveButtonLabel(false, false)).toBe('Saved');
  });
});

describe('saveErrorNotice', () => {
  it('conserva el mensaje del servidor y agrega que nada se perdió', () => {
    const notice = saveErrorNotice('This draft was changed somewhere else.');

    expect(notice).toContain('This draft was changed somewhere else.');
    expect(notice).toContain('has been lost');
  });
});
