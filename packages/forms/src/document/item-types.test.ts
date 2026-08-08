import { describe, expect, it } from 'vitest';

import { RESPONSE_TYPES, templateDocumentSchema } from './schema.js';

/** Envuelve un ítem suelto en el documento mínimo que lo contiene. */
function documentWith(item: Record<string, unknown>): unknown {
  return {
    sections: [
      {
        section_key: 'general',
        section_title: 'General',
        position: 1,
        items: [item],
      },
    ],
  };
}

/** Los campos que todo ítem tiene, para no repetirlos en cada caso. */
function base(response_type: string): Record<string, unknown> {
  return {
    item_key: 'housekeeping.aisles-clear',
    prompt: 'Aisles clear of obstructions?',
    position: 1,
    required: true,
    response_type,
  };
}

function errors(item: Record<string, unknown>): string {
  const result = templateDocumentSchema.safeParse(documentWith(item));

  if (result.success) {
    throw new Error('Se esperaba que el ítem fuera rechazado.');
  }

  return result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n');
}

function accepts(item: Record<string, unknown>): boolean {
  return templateDocumentSchema.safeParse(documentWith(item)).success;
}

/** Un ítem válido de cada tipo. La clave es el `response_type`. */
const validItems: Record<string, Record<string, unknown>> = {
  yes_no: base('yes_no'),
  yes_no_na: base('yes_no_na'),
  scale: { ...base('scale'), min: 1, max: 5 },
  text: { ...base('text'), max_length: 500 },
  number: { ...base('number'), min: 0, max: 120, decimals: 1 },
  single_choice: {
    ...base('single_choice'),
    options: [
      { value: 'ok', label: 'OK' },
      { value: 'blocked', label: 'Blocked' },
    ],
  },
  multi_choice: {
    ...base('multi_choice'),
    options: [
      { value: 'gloves', label: 'Gloves' },
      { value: 'goggles', label: 'Goggles' },
      { value: 'boots', label: 'Boots' },
    ],
    min_selected: 1,
    max_selected: 3,
  },
  photo: { ...base('photo'), min_count: 0, max_count: 5 },
  signature: base('signature'),
};

describe('tipos de ítem', () => {
  it('acepta un ítem válido de cada uno de los nueve tipos', () => {
    for (const responseType of RESPONSE_TYPES) {
      expect(accepts(validItems[responseType]!), responseType).toBe(true);
    }
  });

  it('cubre los nueve tipos con un caso válido', () => {
    expect(Object.keys(validItems).sort()).toEqual([...RESPONSE_TYPES].sort());
  });

  it('rechaza un scale con el rango invertido', () => {
    const message = errors({ ...base('scale'), min: 5, max: 1 });

    expect(message).toContain('min');
    expect(message).toContain('max');
  });

  it('rechaza un number con min mayor que max', () => {
    expect(errors({ ...base('number'), min: 10, max: 1, decimals: 0 })).toContain('min');
  });

  it('rechaza options con el mismo value dos veces', () => {
    const message = errors({
      ...base('single_choice'),
      options: [
        { value: 'ok', label: 'OK' },
        { value: 'ok', label: 'Also OK' },
      ],
    });

    expect(message).toContain('options');
    expect(message).toContain('"ok"');
  });

  it('rechaza un multi_choice que exige más selecciones que las opciones que ofrece', () => {
    const message = errors({
      ...validItems.multi_choice,
      min_selected: 4,
      max_selected: 4,
    });

    expect(message).toContain('min_selected');
  });

  it('rechaza un multi_choice con min_selected mayor que max_selected', () => {
    const message = errors({ ...validItems.multi_choice, min_selected: 3, max_selected: 2 });

    expect(message).toContain('min_selected');
  });

  it('rechaza un photo con min_count mayor que max_count', () => {
    expect(errors({ ...base('photo'), min_count: 4, max_count: 2 })).toContain('min_count');
  });

  it('rechaza un campo de configuración que pertenece a otro tipo', () => {
    const message = errors({
      ...base('text'),
      max_length: 100,
      options: [{ value: 'ok', label: 'OK' }],
    });

    expect(message).toContain('options');
  });

  it('rechaza un tipo al que le falta su configuración', () => {
    expect(errors(base('scale'))).toContain('min');
    expect(errors(base('text'))).toContain('max_length');
    expect(errors(base('single_choice'))).toContain('options');
  });

  it('rechaza un ítem de selección sin opciones', () => {
    expect(errors({ ...base('single_choice'), options: [] })).toContain('options');
  });
});
