import { RESPONSE_TYPES } from '@hs/contracts';
import { describe, expect, it } from 'vitest';

import {
  RESPONSE_TYPE_HINTS,
  RESPONSE_TYPE_LABELS,
  RESPONSE_TYPE_OPTIONS,
  draftStatusClass,
  draftStatusLabel,
  itemCountLabel,
} from './templates';

describe('las etiquetas de tipo de respuesta', () => {
  it('cubren los nueve tipos que declara el motor', () => {
    expect(Object.keys(RESPONSE_TYPE_LABELS).sort()).toEqual([...RESPONSE_TYPES].sort());
    expect(Object.keys(RESPONSE_TYPE_HINTS).sort()).toEqual([...RESPONSE_TYPES].sort());
  });

  it('ninguna está vacía', () => {
    for (const type of RESPONSE_TYPES) {
      expect(RESPONSE_TYPE_LABELS[type].length).toBeGreaterThan(0);
      expect(RESPONSE_TYPE_HINTS[type].length).toBeGreaterThan(0);
    }
  });

  it('las opciones del selector siguen el orden del motor', () => {
    expect(RESPONSE_TYPE_OPTIONS.map((option) => option.value)).toEqual([...RESPONSE_TYPES]);
  });
});

describe('el estado de un borrador', () => {
  it('dice si se puede usar, no si parsea', () => {
    expect(draftStatusLabel(true)).toBe('Ready to publish');
    expect(draftStatusLabel(false)).toBe('Not ready yet');
  });

  it('usa las clases de pastilla que ya existen', () => {
    expect(draftStatusClass(true)).toContain('status-pill--ready');
    expect(draftStatusClass(false)).toContain('status-pill--not-ready');
  });
});

describe('itemCountLabel', () => {
  it('lee el caso vacío como una invitación y no como un error', () => {
    expect(itemCountLabel(0)).toBe('No questions yet');
  });

  it('singulariza el uno', () => {
    expect(itemCountLabel(1)).toBe('1 question');
    expect(itemCountLabel(7)).toBe('7 questions');
  });
});
