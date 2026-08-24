import { describe, expect, it } from 'vitest';

import {
  defaultItemConfig,
  draftFromDocument,
  draftIssues,
  emptyDraftDocument,
  normalizeDraft,
  templateDraftDocumentSchema,
  type TemplateDraftDocument,
  type TemplateDraftItem,
} from './draft.js';
import { ITEM_KEY_PATTERN } from './keys.js';
import { RESPONSE_TYPES, templateDocumentSchema, type TemplateDocument } from './schema.js';

/** Un ítem válido de la forma más simple, para que el ruido lo aporte cada caso. */
function item(overrides: Partial<TemplateDraftItem> = {}): TemplateDraftItem {
  return {
    item_key: 'guard.fitted',
    prompt: 'Is the guard fitted?',
    required: true,
    response_type: 'yes_no',
    ...overrides,
  } as TemplateDraftItem;
}

/** Un borrador publicable: una sección, un ítem, nada de más. */
function draft(overrides: Partial<TemplateDraftDocument> = {}): TemplateDraftDocument {
  return {
    sections: [{ section_key: 'guarding', section_title: 'Guarding', items: [item()] }],
    ...overrides,
  };
}

function messages(document: TemplateDraftDocument): string {
  return draftIssues(document)
    .map((issue) => issue.message)
    .join('\n');
}

describe('templateDraftDocumentSchema', () => {
  it('acepta un borrador vacío', () => {
    expect(templateDraftDocumentSchema.parse(emptyDraftDocument())).toEqual({ sections: [] });
  });

  it('acepta una sección sin ítems y textos vacíos', () => {
    const parsed = templateDraftDocumentSchema.safeParse({
      sections: [{ section_key: '', section_title: '', items: [] }],
    });

    expect(parsed.success).toBe(true);
  });

  it('rechaza un response_type que no existe', () => {
    const parsed = templateDraftDocumentSchema.safeParse({
      sections: [
        {
          section_key: 'guarding',
          section_title: 'Guarding',
          items: [{ ...item(), response_type: 'colour_picker' }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza un campo de configuración que le sobra al tipo', () => {
    const parsed = templateDraftDocumentSchema.safeParse({
      sections: [
        {
          section_key: 'guarding',
          section_title: 'Guarding',
          items: [{ ...item(), max_length: 500 }],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });

  it('rechaza una position: el orden lo lleva el arreglo', () => {
    const parsed = templateDraftDocumentSchema.safeParse({
      sections: [
        {
          section_key: 'guarding',
          section_title: 'Guarding',
          position: 1,
          items: [item()],
        },
      ],
    });

    expect(parsed.success).toBe(false);
  });
});

describe('normalizeDraft', () => {
  it('numera secciones e ítems desde 1 en orden de arreglo', () => {
    const normalized = normalizeDraft({
      sections: [
        {
          section_key: 'intake',
          section_title: 'Intake',
          items: [item({ item_key: 'a' }), item({ item_key: 'b' })],
        },
        { section_key: 'storage', section_title: 'Storage', items: [item({ item_key: 'c' })] },
      ],
    });

    expect(normalized.sections.map((section) => section.position)).toEqual([1, 2]);
    expect(normalized.sections[0]?.items.map((each) => each.position)).toEqual([1, 2]);
    expect(normalized.sections[1]?.items.map((each) => each.position)).toEqual([1]);
  });

  it('mover una sección cambia el orden derivado', () => {
    const moved = normalizeDraft({
      sections: [
        { section_key: 'storage', section_title: 'Storage', items: [item({ item_key: 'c' })] },
        { section_key: 'intake', section_title: 'Intake', items: [item({ item_key: 'a' })] },
      ],
    });

    expect(moved.sections[0]?.section_key).toBe('storage');
    expect(moved.sections[0]?.position).toBe(1);
    expect(moved.sections[1]?.position).toBe(2);
  });

  it('eliminar un ítem cierra el hueco', () => {
    const normalized = normalizeDraft({
      sections: [
        {
          section_key: 'guarding',
          section_title: 'Guarding',
          items: [item({ item_key: 'a' }), item({ item_key: 'c' })],
        },
      ],
    });

    expect(normalized.sections[0]?.items.map((each) => each.position)).toEqual([1, 2]);
  });

  it('el resultado de un borrador completo parsea como documento publicable', () => {
    expect(templateDocumentSchema.safeParse(normalizeDraft(draft())).success).toBe(true);
  });
});

/**
 * El round-trip que garantiza que el esquema laxo no perdió un campo: un
 * documento publicado, sin sus `position`, vuelve a ser exactamente el mismo
 * documento al normalizarse.
 */
describe('el borrador conserva todo lo que tiene un documento publicado', () => {
  function published(): TemplateDocument {
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
              item_key: 'hazard.kind',
              prompt: 'What kind?',
              position: 2,
              required: false,
              response_type: 'multi_choice',
              options: [
                { value: 'slip', label: 'Slip' },
                { value: 'trip', label: 'Trip' },
              ],
              min_selected: 1,
              max_selected: 2,
              visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
            },
          ],
        },
        {
          section_key: 'photos',
          section_title: 'Photos',
          position: 2,
          visible_when: { item_key: 'hazard.present', operator: 'equals', value: true },
          items: [
            {
              item_key: 'hazard.photo',
              prompt: 'Photograph the hazard',
              position: 1,
              required: true,
              response_type: 'photo',
              min_count: 1,
              max_count: 3,
            },
          ],
        },
      ],
    });
  }

  function stripPositions(document: TemplateDocument): TemplateDraftDocument {
    return templateDraftDocumentSchema.parse({
      sections: document.sections.map(({ position: _sectionPosition, items, ...section }) => ({
        ...section,
        items: items.map(({ position: _itemPosition, ...each }) => each),
      })),
    });
  }

  it('normalizar el borrador devuelve el documento original', () => {
    const original = published();

    expect(normalizeDraft(stripPositions(original))).toEqual(original);
  });

  it('un documento publicado no tiene nada que reportar', () => {
    expect(draftIssues(stripPositions(published()))).toEqual([]);
  });
});

describe('draftIssues', () => {
  it('un borrador completo no reporta nada', () => {
    expect(draftIssues(draft())).toEqual([]);
  });

  it('un borrador completo con una prescripción válida no reporta nada', () => {
    expect(
      draftIssues(
        draft({
          sections: [
            {
              section_key: 'guarding',
              section_title: 'Guarding',
              items: [
                item({
                  finding: {
                    corrective_action: 'Refit the machine guard before use.',
                  },
                }),
              ],
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it('reporta una acción correctiva en blanco', () => {
    const issues = draftIssues(
      withItem(
        item({
          finding: { corrective_action: '  ' },
        }),
      ),
    );

    expect(issues[0]?.path).toEqual(['sections', 0, 'items', 0]);
    expect(issues.map((each) => each.message)).toContain(
      'Item "Is the guard fitted?" in section "Guarding": the corrective action cannot be blank.',
    );
  });

  it('reporta un umbral en un tipo que no es medido', () => {
    const issues = draftIssues(
      withItem(
        item({
          finding: {
            corrective_action: 'Refit the machine guard.',
            fails_when: { operator: 'gt', value: 1 },
          },
        }),
      ),
    );

    expect(issues[0]?.path).toEqual(['sections', 0, 'items', 0]);
    expect(issues.map((each) => each.message)).toContain(
      'Item "Is the guard fitted?" in section "Guarding": a failure threshold only applies to scale and number questions.',
    );
  });

  it('reporta un umbral fuera de los límites del ítem', () => {
    const issues = draftIssues(
      withItem(
        item({
          response_type: 'scale',
          min: 1,
          max: 5,
          finding: {
            corrective_action: 'Review the scale result.',
            fails_when: { operator: 'gt', value: 9 },
          },
        }),
      ),
    );

    expect(issues[0]?.path).toEqual(['sections', 0, 'items', 0]);
    expect(issues.map((each) => each.message)).toContain(
      'Item "Is the guard fitted?" in section "Guarding": the failure threshold (9) must be between 1 and 5.',
    );
  });

  it('reporta un borrador sin secciones', () => {
    expect(messages(emptyDraftDocument())).toContain('no sections');
  });

  it('reporta una sección sin ítems y la nombra', () => {
    const issues = draftIssues({
      sections: [{ section_key: 'guarding', section_title: 'Guarding', items: [] }],
    });

    expect(issues.map((each) => each.message)).toContain('Section "Guarding" has no items.');
    expect(issues[0]?.path).toEqual(['sections', 0]);
  });

  it('reporta una sección que no nombra una ubicación organizacional', () => {
    expect(
      messages({
        sections: [
          {
            section_key: 'guarding',
            section_title: 'Guarding',
            organization_location_code: '',
            items: [item()],
          },
        ],
      }),
    ).toContain('does not name an organization location');
  });

  it('nombra una sección sin título por su número', () => {
    expect(
      messages({ sections: [{ section_key: 'guarding', section_title: '', items: [item()] }] }),
    ).toContain('Section 1 has no title.');
  });

  it('reporta una section_key inválida', () => {
    expect(
      messages({
        sections: [{ section_key: 'Guarding!', section_title: 'Guarding', items: [item()] }],
      }),
    ).toContain('invalid key');
  });

  it('reporta dos secciones con la misma clave', () => {
    expect(
      messages({
        sections: [
          { section_key: 'guarding', section_title: 'One', items: [item({ item_key: 'a' })] },
          { section_key: 'guarding', section_title: 'Two', items: [item({ item_key: 'b' })] },
        ],
      }),
    ).toContain('repeats the key "guarding"');
  });

  it('reporta un ítem sin texto y lo ubica', () => {
    const issues = draftIssues({
      sections: [
        { section_key: 'guarding', section_title: 'Guarding', items: [item({ prompt: '  ' })] },
      ],
    });

    expect(issues.map((each) => each.message)).toContain(
      'Item 1 in section "Guarding" has no question text.',
    );
    expect(issues[0]?.path).toEqual(['sections', 0, 'items', 0]);
  });

  it('reporta una item_key inválida', () => {
    expect(messages(withItem(item({ item_key: 'Guard Fitted' })))).toContain('invalid key');
  });

  it('reporta dos ítems con la misma clave, aunque estén en secciones distintas', () => {
    expect(
      messages({
        sections: [
          { section_key: 'one', section_title: 'One', items: [item()] },
          { section_key: 'two', section_title: 'Two', items: [item()] },
        ],
      }),
    ).toContain('repeats the key "guard.fitted"');
  });

  it('reporta una escala al revés', () => {
    expect(messages(withItem(item({ response_type: 'scale', min: 5, max: 1 })))).toContain(
      'scale minimum (5) must be lower than its maximum (1)',
    );
  });

  it('reporta una escala con extremos no enteros', () => {
    expect(messages(withItem(item({ response_type: 'scale', min: 1.5, max: 5 })))).toContain(
      'whole numbers',
    );
  });

  it('reporta un largo máximo de texto en cero', () => {
    expect(messages(withItem(item({ response_type: 'text', max_length: 0 })))).toContain(
      'maximum length',
    );
  });

  it('reporta un número con mínimo mayor que el máximo', () => {
    expect(
      messages(withItem(item({ response_type: 'number', min: 10, max: 1, decimals: 0 }))),
    ).toContain('cannot be greater than the maximum');
  });

  it('reporta decimales negativos', () => {
    expect(
      messages(withItem(item({ response_type: 'number', min: 0, max: 10, decimals: -1 }))),
    ).toContain('decimals');
  });

  it('reporta una selección sin opciones', () => {
    expect(messages(withItem(item({ response_type: 'single_choice', options: [] })))).toContain(
      'offers no options',
    );
  });

  it('reporta una opción sin etiqueta', () => {
    expect(
      messages(
        withItem(item({ response_type: 'single_choice', options: [{ value: 'yes', label: '' }] })),
      ),
    ).toContain('no label');
  });

  it('reporta un value de opción repetido', () => {
    expect(
      messages(
        withItem(
          item({
            response_type: 'single_choice',
            options: [
              { value: 'yes', label: 'Yes' },
              { value: 'yes', label: 'Also yes' },
            ],
          }),
        ),
      ),
    ).toContain('repeats the option value "yes"');
  });

  it('reporta min_selected mayor que max_selected', () => {
    expect(
      messages(
        withItem(
          item({
            response_type: 'multi_choice',
            options: [
              { value: 'a', label: 'A' },
              { value: 'b', label: 'B' },
            ],
            min_selected: 2,
            max_selected: 1,
          }),
        ),
      ),
    ).toContain('cannot be greater than the maximum');
  });

  it('reporta límites de selección que superan las opciones ofrecidas', () => {
    expect(
      messages(
        withItem(
          item({
            response_type: 'multi_choice',
            options: [{ value: 'a', label: 'A' }],
            min_selected: 0,
            max_selected: 3,
          }),
        ),
      ),
    ).toContain('more than the 1 option(s) offered');
  });

  it('reporta un mínimo de fotos mayor que el máximo', () => {
    expect(
      messages(withItem(item({ response_type: 'photo', min_count: 4, max_count: 2 }))),
    ).toContain('cannot be greater than the maximum');
  });

  it('reporta una condición que referencia una item_key inexistente', () => {
    expect(
      messages(
        withItem(
          item({
            visible_when: { item_key: 'nowhere', operator: 'answered' },
          }),
        ),
      ),
    ).toContain('which no item in this template answers');
  });

  it('reporta una condición que mira hacia adelante', () => {
    expect(
      messages({
        sections: [
          {
            section_key: 'guarding',
            section_title: 'Guarding',
            items: [
              item({
                item_key: 'guard.first',
                visible_when: { item_key: 'guard.second', operator: 'answered' },
              }),
              item({ item_key: 'guard.second' }),
            ],
          },
        ],
      }),
    ).toContain('comes later in the template');
  });

  it('reporta una condición que se referencia a sí misma', () => {
    expect(
      messages(
        withItem(item({ visible_when: { item_key: 'guard.fitted', operator: 'answered' } })),
      ),
    ).toContain('comes later in the template');
  });
});

/**
 * La red de seguridad de `draftIssues` es un renglón inalcanzable: mientras las
 * comprobaciones explícitas cubran todo lo que `templateDocumentSchema` rechaza,
 * ningún caso llega hasta él. Este test lo afirma sobre todos los de arriba, así
 * que un refinement nuevo en `schema.ts` sin su mensaje en inglés rompe acá y no
 * en pantalla.
 */
describe('sin issues equivale a publicable', () => {
  const cases: TemplateDraftDocument[] = [
    draft(),
    emptyDraftDocument(),
    { sections: [{ section_key: 'guarding', section_title: 'Guarding', items: [] }] },
    { sections: [{ section_key: '', section_title: '', items: [item({ prompt: '' })] }] },
    withItem(item({ response_type: 'scale', min: 5, max: 1 })),
    withItem(item({ response_type: 'text', max_length: 0 })),
    withItem(item({ response_type: 'number', min: 10, max: 1, decimals: -1 })),
    withItem(item({ response_type: 'single_choice', options: [] })),
    withItem(
      item({
        response_type: 'multi_choice',
        options: [{ value: 'a', label: 'A' }],
        min_selected: 3,
        max_selected: 1,
      }),
    ),
    withItem(item({ response_type: 'photo', min_count: 4, max_count: 2 })),
    withItem(item({ visible_when: { item_key: 'nowhere', operator: 'answered' } })),
    { sections: [{ section_key: 'a', section_title: 'A', items: [item(), item()] }] },
  ];

  it.each(cases.map((each, index) => [index, each] as const))(
    'caso %i: los issues y el esquema estricto coinciden',
    (_index, document) => {
      const issues = draftIssues(document);
      const publishable = templateDocumentSchema.safeParse(normalizeDraft(document)).success;

      expect(issues.length === 0).toBe(publishable);
      expect(issues.map((each) => each.message)).not.toContain(
        'This template cannot be published yet.',
      );
    },
  );
});

describe('defaultItemConfig', () => {
  it('produce un ítem publicable para cada tipo de respuesta', () => {
    for (const responseType of RESPONSE_TYPES) {
      const configured = {
        item_key: 'sample.item',
        prompt: 'Sample',
        required: true,
        response_type: responseType,
        ...defaultItemConfig(responseType),
      };

      const parsed = templateDraftDocumentSchema.safeParse({
        sections: [{ section_key: 'sample', section_title: 'Sample', items: [configured] }],
      });

      expect(parsed.success, `${responseType} no parsea como borrador`).toBe(true);
    }
  });

  it('las selecciones nacen sin opciones, que es lo único que falta completar', () => {
    expect(defaultItemConfig('single_choice')).toEqual({ options: [] });
    expect(messages(withItem(item({ response_type: 'single_choice', options: [] })))).toContain(
      'offers no options',
    );
  });

  it('los tipos sin configuración no agregan campos', () => {
    expect(defaultItemConfig('yes_no')).toEqual({});
    expect(defaultItemConfig('yes_no_na')).toEqual({});
    expect(defaultItemConfig('signature')).toEqual({});
  });
});

describe('ITEM_KEY_PATTERN sigue siendo el mismo de siempre', () => {
  it('acepta las claves que el borrador propone y rechaza las que no', () => {
    expect(ITEM_KEY_PATTERN.test('guard.fitted')).toBe(true);
    expect(ITEM_KEY_PATTERN.test('guard-fitted-2')).toBe(true);
    expect(ITEM_KEY_PATTERN.test('Guard Fitted')).toBe(false);
    expect(ITEM_KEY_PATTERN.test('')).toBe(false);
  });
});

function withItem(only: TemplateDraftItem): TemplateDraftDocument {
  return { sections: [{ section_key: 'guarding', section_title: 'Guarding', items: [only] }] };
}

describe('draftFromDocument devuelve el documento congelado a forma de borrador', () => {
  const draft: TemplateDraftDocument = {
    sections: [
      {
        section_key: 'guarding',
        section_title: 'Guarding',
        organization_location_code: 'line-3',
        items: [
          {
            item_key: 'guard.fitted',
            prompt: 'Is the guard fitted?',
            required: true,
            response_type: 'yes_no',
          },
          {
            item_key: 'guard.gap',
            prompt: 'Gap in millimetres',
            required: false,
            response_type: 'number',
            min: 0,
            max: 50,
            decimals: 1,
          },
        ],
      },
      {
        section_key: 'housekeeping',
        section_title: 'Housekeeping',
        items: [
          {
            item_key: 'floor.clear',
            prompt: 'Are the walkways clear?',
            required: true,
            response_type: 'yes_no_na',
          },
        ],
      },
    ],
  };

  it('es la inversa exacta de normalizeDraft', () => {
    expect(draftFromDocument(normalizeDraft(draft))).toEqual(draft);
  });

  it('el resultado es un borrador válido', () => {
    const parsed = templateDraftDocumentSchema.safeParse(draftFromDocument(normalizeDraft(draft)));

    expect(parsed.success).toBe(true);
  });

  it('saca la position y no toca nada más', () => {
    const sembrado = draftFromDocument(normalizeDraft(draft));

    expect(sembrado.sections[0]).not.toHaveProperty('position');
    expect(sembrado.sections[0]?.items[0]).not.toHaveProperty('position');
    // El item_key es lo que hace que la versión N+1 conserve la serie de recurrencia.
    expect(sembrado.sections[0]?.items.map((item) => item.item_key)).toEqual([
      'guard.fitted',
      'guard.gap',
    ]);
    expect(sembrado.sections[0]?.organization_location_code).toBe('line-3');
  });

  it('lo que sale se puede volver a publicar sin issues', () => {
    expect(draftIssues(draftFromDocument(normalizeDraft(draft)))).toEqual([]);
  });
});
