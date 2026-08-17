import { describe, expect, it } from 'vitest';

import {
  civilMonth,
  civilToday,
  currentCivilYear,
  formatCivilDay,
  formatDay,
  formatInstant,
  monthName,
} from './dates';

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

  it('el día civil de hoy resuelve en la zona de la planta, no en UTC', () => {
    expect(civilToday(new Date('2026-09-01T02:00:00.000Z'))).toBe('2026-08-31');
  });
});

describe('el día de cierre en una celda', () => {
  it('se escribe corto, en inglés y sin depender del locale', () => {
    expect(formatCivilDay('2027-07-29T18:00:00.000Z')).toBe('Jul 29, 2027');
    expect(formatCivilDay('2027-05-30T18:00:00.000Z')).toBe('May 30, 2027');
  });

  it('no rellena el día con cero', () => {
    expect(formatCivilDay('2027-09-01T18:00:00.000Z')).toBe('Sep 1, 2027');
  });

  /**
   * El caso que justifica resolver el huso en vez de recortar la cadena, como hace
   * `formatDay`: una inspección firmada a las 21:00 del último día del mes en Ontario llega
   * como el día 1 del mes SIGUIENTE en UTC, y el mes es lo que identifica la obligación.
   */
  it('fecha en el día de la planta y no en el de UTC', () => {
    expect(formatCivilDay('2027-08-01T01:00:00.000Z')).toBe('Jul 31, 2027');
  });
});
