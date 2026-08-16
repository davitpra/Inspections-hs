import { describe, expect, it } from 'vitest';

import { civilMonth, currentCivilYear, formatDay, formatInstant, monthName } from './dates';

describe('cómo se lee un instante', () => {
  it('un plazo se lee por día', () => {
    expect(formatDay('2026-08-17T13:00:00.000Z')).toBe('2026-08-17');
  });

  it('un reloj regulatorio se lee con la hora, que ahí es el plazo', () => {
    expect(formatInstant('2026-08-17T13:00:00.000Z')).toBe('2026-08-17 13:00');
  });

  /**
   * El motivo de recortar en vez de formatear con `Intl`: un envío de las 23:00 UTC no
   * puede aparecer con un día en una pantalla y con otro en la de al lado.
   */
  it('no desplaza al huso del dispositivo', () => {
    expect(formatDay('2026-08-17T23:30:00.000Z')).toBe('2026-08-17');
    expect(formatDay('2026-08-17T00:30:00.000Z')).toBe('2026-08-17');
  });
});

describe('el período', () => {
  it('se lee por mes', () => {
    expect(monthName('2026-08-01')).toBe('August');
    expect(monthName('2026-01-01')).toBe('January');
  });
});

describe('el mes civil', () => {
  it('resuelve el mes en la zona de la planta, no en UTC', () => {
    // 2026-09-01T02:00:00Z es 2026-08-31 en America/Toronto.
    expect(civilMonth(new Date('2026-09-01T02:00:00.000Z'))).toBe('2026-08');
  });

  it('el año en curso es el de esa misma fecha civil', () => {
    expect(currentCivilYear(new Date('2026-09-01T02:00:00.000Z'))).toBe('2026');
  });
});
