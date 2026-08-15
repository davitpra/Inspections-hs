import { describe, expect, it } from 'vitest';

import { monthLabel, yearChoices, yearOf } from './presentation';

describe('el rango del año', () => {
  it('cubre el año entero, del primero de enero al treinta y uno de diciembre', () => {
    expect(yearOf(2026)).toEqual({ rangeStart: '2026-01-01', rangeEnd: '2026-12-31' });
  });

  it('ofrece el año en curso y los cuatro anteriores', () => {
    expect(yearChoices(2026)).toEqual([2026, 2025, 2024, 2023, 2022]);
  });
});

describe('la etiqueta del período', () => {
  it('recorta el día: la grilla es de meses', () => {
    expect(monthLabel('2026-04-01')).toBe('2026-04');
  });
});
