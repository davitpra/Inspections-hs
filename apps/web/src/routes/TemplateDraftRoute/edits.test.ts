import { draftIssues, type TemplateDraftDocument } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  addItem,
  addOption,
  addSection,
  allItemKeys,
  changeResponseType,
  duplicateItem,
  duplicateSection,
  freeKey,
  moveItem,
  moveSection,
  removeItem,
  removeOption,
  removeSection,
  renameSection,
  setConfig,
  setOption,
  setPrompt,
  setRequired,
} from './edits';
import { newKey, newKeys } from './newKey';

/** Dos secciones con dos ítems cada una, para que mover tenga a dónde. */
function document(): TemplateDraftDocument {
  return {
    sections: [
      {
        section_key: 'intake',
        section_title: 'Intake',
        items: [
          { item_key: 'a', prompt: 'A', required: true, response_type: 'yes_no' },
          { item_key: 'b', prompt: 'B', required: true, response_type: 'yes_no' },
        ],
      },
      {
        section_key: 'storage',
        section_title: 'Storage',
        items: [{ item_key: 'c', prompt: 'C', required: true, response_type: 'yes_no' }],
      },
    ],
  };
}

const sectionKeys = (draft: TemplateDraftDocument): string[] =>
  draft.sections.map((section) => section.section_key);

describe('las operaciones no mutan su entrada', () => {
  /**
   * El documento vive en un `useState`. Una operación que devolviera el mismo objeto
   * modificado dejaría a React sin motivo para volver a dibujar, y el autor seguiría
   * escribiendo sobre una pantalla que ya no corresponde al estado.
   */
  it('ninguna devuelve el mismo objeto ni toca el original', () => {
    const original = document();
    const snapshot = structuredClone(original);

    const results = [
      addSection(original, 'new-section'),
      duplicateSection(original, 0, { section: 'copy', items: ['a2', 'b2'] }),
      duplicateItem(original, 0, 0, 'a2'),
      renameSection(original, 0, 'Renamed'),
      moveSection(original, 1, -1),
      removeSection(original, 0),
      addItem(original, 0, 'new-item'),
      setPrompt(original, 0, 0, 'Changed'),
      moveItem(original, 0, 1, -1),
      removeItem(original, 0, 0),
      changeResponseType(original, 0, 0, 'text'),
    ];

    for (const result of results) {
      expect(result).not.toBe(original);
    }

    expect(original).toEqual(snapshot);
  });
});

describe('reordenar', () => {
  it('sube una sección', () => {
    expect(sectionKeys(moveSection(document(), 1, -1))).toEqual(['storage', 'intake']);
  });

  it('baja una sección', () => {
    expect(sectionKeys(moveSection(document(), 0, 1))).toEqual(['storage', 'intake']);
  });

  it('no hace nada en los extremos', () => {
    expect(sectionKeys(moveSection(document(), 0, -1))).toEqual(['intake', 'storage']);
    expect(sectionKeys(moveSection(document(), 1, 1))).toEqual(['intake', 'storage']);
  });

  it('no hace nada con un índice que no existe', () => {
    expect(sectionKeys(moveSection(document(), 9, -1))).toEqual(['intake', 'storage']);
  });

  it('sube un ítem dentro de su sección', () => {
    const moved = moveItem(document(), 0, 1, -1);

    expect(moved.sections[0]?.items.map((item) => item.item_key)).toEqual(['b', 'a']);
  });

  it('un ítem no se escapa de su sección', () => {
    const moved = moveItem(document(), 0, 0, -1);

    expect(moved.sections[0]?.items).toHaveLength(2);
    expect(moved.sections[1]?.items).toHaveLength(1);
  });
});

describe('agregar y quitar', () => {
  it('dos elementos nuevos reciben claves opacas distintas', () => {
    const first = newKey();
    const second = newKey([first]);

    expect(first).toMatch(/^[a-z0-9]{12}$/);
    expect(second).toMatch(/^[a-z0-9]{12}$/);
    expect(second).not.toBe(first);
  });

  it('la sección nueva nace sin ítems, y por eso no publicable', () => {
    const added = addSection(document(), 'new-section');
    const last = added.sections.at(-1);

    expect(added.sections).toHaveLength(3);
    expect(last?.items).toEqual([]);
    expect(draftIssues(added).map((issue) => issue.message).join()).toContain('has no items');
  });

  it('la sección nueva no repite una section_key', () => {
    let draft = addSection(document(), 'new-section');
    draft = addSection(draft, 'new-section-2');

    expect(new Set(sectionKeys(draft)).size).toBe(sectionKeys(draft).length);
  });

  it('el ítem nuevo nace yes_no y con una item_key libre', () => {
    const added = addItem(document(), 0, 'new-item');
    const last = added.sections[0]?.items.at(-1);

    expect(last?.response_type).toBe('yes_no');
    expect(last?.prompt).toBe('');
    expect(new Set(allItemKeys(added)).size).toBe(allItemKeys(added).length);
  });

  it('el ítem nuevo no repite una item_key de OTRA sección', () => {
    let draft = document();
    draft = addItem(draft, 0, 'new-item-a');
    draft = addItem(draft, 1, 'new-item-b');

    expect(new Set(allItemKeys(draft)).size).toBe(allItemKeys(draft).length);
  });

  it('quitar un ítem deja los demás en su orden', () => {
    const removed = removeItem(document(), 0, 0);

    expect(removed.sections[0]?.items.map((item) => item.item_key)).toEqual(['b']);
  });

  it('quitar una sección se lleva sus ítems', () => {
    const removed = removeSection(document(), 0);

    expect(sectionKeys(removed)).toEqual(['storage']);
    expect(allItemKeys(removed)).toEqual(['c']);
  });
});

describe('changeResponseType', () => {
  it('de text a single_choice deja options y ningún max_length', () => {
    const asText = changeResponseType(document(), 0, 0, 'text');
    const asChoice = changeResponseType(asText, 0, 0, 'single_choice');
    const item = asChoice.sections[0]?.items[0];

    expect(item?.response_type).toBe('single_choice');
    expect(item).toHaveProperty('options');
    expect(item).not.toHaveProperty('max_length');
  });

  it('de number a yes_no no deja min, max ni decimals', () => {
    const asNumber = changeResponseType(document(), 0, 0, 'number');
    const asYesNo = changeResponseType(asNumber, 0, 0, 'yes_no');
    const item = asYesNo.sections[0]?.items[0];

    expect(item).not.toHaveProperty('min');
    expect(item).not.toHaveProperty('max');
    expect(item).not.toHaveProperty('decimals');
  });

  it('conserva la identidad y el texto de la pregunta', () => {
    const changed = changeResponseType(document(), 0, 0, 'scale');
    const item = changed.sections[0]?.items[0];

    expect(item?.item_key).toBe('a');
    expect(item?.prompt).toBe('A');
    expect(item?.required).toBe(true);
  });

  it('conserva visible_when, que no depende del tipo', () => {
    const withCondition = setConditionOnSecondItem(document());
    const changed = changeResponseType(withCondition, 0, 1, 'text');

    expect(changed.sections[0]?.items[1]).toHaveProperty('visible_when');
  });

  it('no toca nada si el tipo ya era ese', () => {
    const draft = document();

    expect(changeResponseType(draft, 0, 0, 'yes_no').sections[0]?.items[0]).toBe(
      draft.sections[0]?.items[0],
    );
  });

  /**
   * La razón de ser de la función: cada tipo nace con una configuración que su propio
   * esquema acepta, así que cambiar de tipo nunca deja el documento con basura del anterior.
   */
  it('recorrer los nueve tipos nunca deja el documento con campos de otro', () => {
    let draft = document();

    for (const type of [
      'scale',
      'text',
      'number',
      'single_choice',
      'multi_choice',
      'photo',
      'signature',
      'yes_no_na',
      'yes_no',
    ] as const) {
      draft = changeResponseType(draft, 0, 0, type);
      const item = draft.sections[0]?.items[0];

      expect(item?.response_type).toBe(type);
      // Lo único que puede faltar es lo que el autor todavía no completó (las opciones),
      // nunca un campo que sobra: eso sería un `strictObject` rechazándolo al publicar.
      const complaints = draftIssues(draft)
        .map((issue) => issue.message)
        .join();
      expect(complaints).not.toContain('Unrecognized');
    }
  });
});

describe('las opciones de un ítem de selección', () => {
  function withChoice(): TemplateDraftDocument {
    return changeResponseType(document(), 0, 0, 'single_choice');
  }

  it('se agregan con un value libre y sin etiqueta', () => {
    const added = addOption(withChoice(), 0, 0);
    const item = added.sections[0]?.items[0];

    expect(item).toMatchObject({ response_type: 'single_choice' });
    expect((item as { options: unknown[] }).options).toHaveLength(1);
  });

  it('dos opciones seguidas no comparten value', () => {
    let draft = addOption(withChoice(), 0, 0);
    draft = addOption(draft, 0, 0);

    const options = (draft.sections[0]?.items[0] as { options: { value: string }[] }).options;

    expect(new Set(options.map((option) => option.value)).size).toBe(2);
  });

  it('se editan por índice', () => {
    let draft = addOption(withChoice(), 0, 0);
    draft = setOption(draft, 0, 0, 0, { value: 'yes', label: 'Yes' });

    const options = (draft.sections[0]?.items[0] as { options: { label: string }[] }).options;

    expect(options[0]).toEqual({ value: 'yes', label: 'Yes' });
  });

  it('se quitan por índice', () => {
    let draft = addOption(withChoice(), 0, 0);
    draft = addOption(draft, 0, 0);
    draft = removeOption(draft, 0, 0, 0);

    const options = (draft.sections[0]?.items[0] as { options: unknown[] }).options;

    expect(options).toHaveLength(1);
  });

  it('sobre un ítem que no es de selección no hacen nada', () => {
    const draft = document();

    expect(addOption(draft, 0, 0)).toEqual(draft);
    expect(removeOption(draft, 0, 0, 0)).toEqual(draft);
  });
});

describe('setConfig', () => {
  it('cambia un campo del tipo actual', () => {
    const asScale = changeResponseType(document(), 0, 0, 'scale');
    const changed = setConfig(asScale, 0, 0, 'max', 10);

    expect(changed.sections[0]?.items[0]).toMatchObject({ max: 10 });
  });

  it('ignora un campo que el tipo no tiene, en vez de agregárselo', () => {
    const draft = document();
    const unchanged = setConfig(draft, 0, 0, 'max_length', 500);

    expect(unchanged.sections[0]?.items[0]).not.toHaveProperty('max_length');
  });
});

describe('los campos que no dependen del tipo', () => {
  it('setPrompt y setRequired escriben lo que dicen', () => {
    let draft = setPrompt(document(), 0, 0, 'Is the guard fitted?');
    draft = setRequired(draft, 0, 0, false);

    expect(draft.sections[0]?.items[0]).toMatchObject({
      prompt: 'Is the guard fitted?',
      item_key: 'a',
      required: false,
    });
  });

  it('renameSection escribe el título y no la clave', () => {
    const renamed = renameSection(document(), 0, 'Receiving');

    expect(renamed.sections[0]?.section_title).toBe('Receiving');
    expect(renamed.sections[0]?.section_key).toBe('intake');
  });
});

describe('freeKey', () => {
  it('devuelve el prefijo cuando está libre', () => {
    expect(freeKey('section', [])).toBe('section');
  });

  it('numera desde 2 y salta lo tomado', () => {
    expect(freeKey('section', ['section'])).toBe('section-2');
    expect(freeKey('section', ['section', 'section-2', 'section-3'])).toBe('section-4');
  });
});

/** Un `visible_when` puesto a mano: el editor no lo escribe, pero no debe perderlo. */
function setConditionOnSecondItem(draft: TemplateDraftDocument): TemplateDraftDocument {
  const [first, second] = draft.sections[0]?.items ?? [];

  if (!first || !second) throw new Error('El documento de prueba cambió.');

  return {
    sections: draft.sections.map((section, index) =>
      index === 0
        ? {
            ...section,
            items: [
              first,
              { ...second, visible_when: { item_key: first.item_key, operator: 'answered' } },
            ],
          }
        : section,
    ),
  };
}

describe('duplicar', () => {
  /** Un documento con configuración y condición, que es donde duplicar tiene filo. */
  function rich(): TemplateDraftDocument {
    return {
      sections: [
        {
          section_key: 'intake',
          section_title: 'Intake',
          organization_location_code: 'dock',
          items: [
            { item_key: 'a', prompt: 'A', required: true, response_type: 'yes_no' },
            {
              item_key: 'b',
              prompt: 'How bad?',
              required: false,
              response_type: 'scale',
              min: 1,
              max: 5,
              visible_when: { item_key: 'a', operator: 'equals', value: true },
            },
          ],
        },
      ],
    };
  }

  describe('duplicateItem', () => {
    it('copia el contenido y toma una identidad nueva', () => {
      const next = duplicateItem(rich(), 0, 1, 'b-copy');
      const copy = next.sections[0]!.items[2]!;

      expect(copy).toMatchObject({
        item_key: 'b-copy',
        prompt: 'How bad?',
        required: false,
        response_type: 'scale',
        min: 1,
        max: 5,
      });
      expect(allItemKeys(next)).toEqual(['a', 'b', 'b-copy']);
    });

    it('queda justo debajo del original, no al final', () => {
      const next = duplicateItem(rich(), 0, 0, 'a-copy');

      expect(next.sections[0]!.items.map((item) => item.item_key)).toEqual(['a', 'a-copy', 'b']);
    });

    it('NO arrastra la condición de visibilidad', () => {
      const next = duplicateItem(rich(), 0, 1, 'b-copy');

      expect(next.sections[0]!.items[2]).not.toHaveProperty('visible_when');
      // Y el original la conserva: duplicar no edita lo que se duplicó.
      expect(next.sections[0]!.items[1]).toHaveProperty('visible_when');
    });

    it('un índice que no existe deja el documento igual', () => {
      const original = rich();

      expect(duplicateItem(original, 0, 9, 'nope')).toEqual(original);
    });
  });

  describe('duplicateSection', () => {
    it('copia las preguntas en el mismo orden y con identidades nuevas', () => {
      const next = duplicateSection(rich(), 0, { section: 'intake-copy', items: ['a2', 'b2'] });

      expect(sectionKeys(next)).toEqual(['intake', 'intake-copy']);
      expect(next.sections[1]!.items.map((item) => item.prompt)).toEqual(['A', 'How bad?']);
      expect(new Set(allItemKeys(next)).size).toBe(allItemKeys(next).length);
    });

    it('conserva el título y la ubicación, que son lo que la sección ES', () => {
      const next = duplicateSection(rich(), 0, { section: 'intake-copy', items: ['a2', 'b2'] });

      expect(next.sections[1]).toMatchObject({
        section_title: 'Intake',
        organization_location_code: 'dock',
      });
    });

    it('queda justo debajo de la original', () => {
      const three: TemplateDraftDocument = {
        sections: [
          { section_key: 'one', section_title: 'One', items: [] },
          { section_key: 'two', section_title: 'Two', items: [] },
          { section_key: 'three', section_title: 'Three', items: [] },
        ],
      };

      const next = duplicateSection(three, 0, { section: 'one-copy', items: [] });

      expect(sectionKeys(next)).toEqual(['one', 'one-copy', 'two', 'three']);
    });

    it('el duplicado no hereda ninguna condición de visibilidad', () => {
      const next = duplicateSection(rich(), 0, { section: 'intake-copy', items: ['a2', 'b2'] });

      expect(next.sections[1]!.items[1]).not.toHaveProperty('visible_when');
    });

    /**
     * La razón por la que existe `newKeys`: duplicar tiene que producir un documento que
     * `draftIssues` acepte, y dos claves repetidas son exactamente lo que reporta.
     */
    it('con claves de `newKeys` el documento no gana ni un issue', () => {
      const original = rich();
      const before = draftIssues(original).length;
      const keys = newKeys(3, [...allItemKeys(original), ...sectionKeys(original)]);

      const next = duplicateSection(original, 0, { section: keys[0]!, items: keys.slice(1) });

      expect(draftIssues(next).length).toBe(before);
    });

    it('una sección que no existe deja el documento igual', () => {
      const original = rich();

      expect(duplicateSection(original, 9, { section: 'x', items: [] })).toEqual(original);
    });
  });
});
