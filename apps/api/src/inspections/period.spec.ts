import { describe, expect, it } from 'vitest';

import { civilDate, currentPeriodStart } from './period';

const TORONTO = 'America/Toronto';

/**
 * El período es una fecha civil de Ontario. Estos casos son los que se rompen si
 * alguien "simplifica" esto a `toISOString().slice(0, 7)`.
 */
describe('currentPeriodStart', () => {
  it('usa el mes local y no el de UTC en el cruce de fin de mes', () => {
    // 1 de septiembre 02:00 UTC es el 31 de agosto 22:00 en Ontario.
    expect(currentPeriodStart(new Date('2026-09-01T02:00:00Z'), TORONTO)).toBe('2026-08-01');
  });

  it('respeta el horario de verano en las dos direcciones', () => {
    // En horario de verano el offset es -4: 1 de julio 03:00 UTC sigue siendo junio.
    expect(currentPeriodStart(new Date('2026-07-01T03:00:00Z'), TORONTO)).toBe('2026-06-01');

    // En horario estándar el offset es -5: 1 de enero 04:00 UTC sigue siendo diciembre.
    expect(currentPeriodStart(new Date('2026-01-01T04:00:00Z'), TORONTO)).toBe('2025-12-01');
  });

  it('devuelve el mes en curso cuando la hora local no está en el borde', () => {
    expect(currentPeriodStart(new Date('2026-08-15T16:00:00Z'), TORONTO)).toBe('2026-08-01');
  });
});

describe('civilDate', () => {
  it('devuelve YYYY-MM-DD, que es lo que la base espera y lo que ordena bien', () => {
    expect(civilDate(new Date('2026-03-09T05:30:00Z'), TORONTO)).toBe('2026-03-09');
  });

  it('la misma instantánea cae en días distintos según la zona', () => {
    const instant = new Date('2026-09-01T02:00:00Z');

    expect(civilDate(instant, TORONTO)).toBe('2026-08-31');
    expect(civilDate(instant, 'UTC')).toBe('2026-09-01');
  });
});
