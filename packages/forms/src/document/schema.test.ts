import { describe, expect, it } from 'vitest';

import { templateDocumentSchema, type TemplateDocument } from './schema.js';

/** Documento mínimo válido. Cada test lo deforma en un solo punto. */
function validDocument(): TemplateDocument {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [
          {
            item_key: 'guards.packaging-lines',
            prompt: 'Machine guards present?',
            position: 4,
            response_type: 'yes_no',
            required: true,
            fails_on: 'no',
          },
          {
            item_key: 'housekeeping.aisles-clear',
            prompt: 'Aisles clear of obstructions?',
            position: 5,
            response_type: 'yes_no',
            required: true,
            fails_on: 'no',
          },
        ],
      },
    ],
  };
}

/** Los mensajes de todos los issues, concatenados. */
function errors(input: unknown): string {
  const result = templateDocumentSchema.safeParse(input);

  if (result.success) {
    throw new Error('Se esperaba que el documento fuera rechazado.');
  }

  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
}

describe('templateDocumentSchema', () => {
  it('acepta un documento válido', () => {
    expect(templateDocumentSchema.parse(validDocument())).toEqual(validDocument());
  });

  it('rechaza un ítem sin item_key', () => {
    const document = validDocument();
    delete (document.sections[0]!.items[0] as Partial<{ item_key: string }>).item_key;

    expect(errors(document)).toContain('item_key');
  });

  it('rechaza una item_key con formato inválido', () => {
    const document = validDocument();
    document.sections[0]!.items[0]!.item_key = 'Guards Packaging Lines';

    expect(errors(document)).toContain('item_key');
  });

  it('rechaza un response_type que no está en el enum', () => {
    const document = validDocument();
    (document.sections[0]!.items[0] as { response_type: string }).response_type = 'rating_stars';

    expect(errors(document)).toContain('response_type');
  });

  it('rechaza dos ítems con la misma position en la misma sección', () => {
    const document = validDocument();
    document.sections[0]!.items[1]!.position = document.sections[0]!.items[0]!.position;

    const message = errors(document);

    expect(message).toContain('general');
    expect(message).toContain('position 4');
  });

  it('acepta la misma position en dos secciones distintas', () => {
    const document = validDocument();
    document.sections.push({
      section_key: 'machine-safety',
      section_title: 'Machine safety',
      position: 2,
      items: [
        {
          item_key: 'lockout.tags-present',
          prompt: 'Lockout tags present?',
          position: 4,
          response_type: 'yes_no',
          required: true,
          fails_on: 'no',
        },
      ],
    });

    expect(templateDocumentSchema.safeParse(document).success).toBe(true);
  });

  it('rechaza una item_key repetida en dos secciones', () => {
    const document = validDocument();
    document.sections.push({
      section_key: 'machine-safety',
      section_title: 'Machine safety',
      position: 2,
      items: [
        {
          item_key: 'guards.packaging-lines',
          prompt: 'Machine guards present?',
          position: 1,
          response_type: 'yes_no',
          required: true,
          fails_on: 'no',
        },
      ],
    });

    expect(errors(document)).toContain('guards.packaging-lines');
  });

  it('rechaza una sección repetida y dos secciones en la misma position', () => {
    const document = validDocument();
    document.sections.push({ ...validDocument().sections[0]! });

    const message = errors(document);

    expect(message).toContain('general');
    expect(message).toContain('position 1');
  });

  it('rechaza un campo desconocido en lugar de ignorarlo', () => {
    const document = validDocument();
    (document.sections[0]!.items[0] as Record<string, unknown>).weight = 3;

    expect(errors(document)).toContain('weight');
  });

  it('acepta un ítem con y sin prescripción', () => {
    const document = validDocument();
    document.sections[0]!.items[0] = {
      ...document.sections[0]!.items[0]!,
      finding: {
        corrective_action: 'Refit the machine guard before use.',
      },
    };

    expect(templateDocumentSchema.safeParse(document).success).toBe(true);
    expect(templateDocumentSchema.safeParse(validDocument()).success).toBe(true);
  });

  it('rechaza control_level aunque el valor de la jerarquía sea válido', () => {
    const document = validDocument();
    (document.sections[0]!.items[0] as Record<string, unknown>).finding = {
      corrective_action: 'Refit the guard.',
      control_level: 'engineering',
    };

    expect(errors(document)).toContain('control_level');
  });

  it('rechaza un operador de umbral desconocido', () => {
    const document = validDocument();
    (document.sections[0]!.items[0] as Record<string, unknown>).finding = {
      corrective_action: 'Refit the guard.',
      fails_when: { operator: 'equals', value: 1 },
    };

    expect(errors(document)).toContain('operator');
  });

  it('rechaza un documento sin secciones', () => {
    expect(errors({ sections: [] })).toContain('sections');
  });
});
