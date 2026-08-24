import { describe, expect, it } from 'vitest';

import { civilDate, containingPeriodStart, currentPeriodStart, startsPeriod } from './period';

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

/**
 * LOS MISMOS CASOS ESTÁN FIJADOS EN `apps/web/src/routes/SchedulingRoute/presentation.test.ts`
 * y son la única defensa contra que las tres copias de esta aritmética —esta, la expresión
 * SQL del trabajo de apertura y la del cliente— se separen. El cliente no puede importar
 * de `apps/api`, así que la duplicación es inevitable; la divergencia silenciosa no.
 */
describe('containingPeriodStart', () => {
  it('para una regla mensual, todo mes es su propio período', () => {
    expect(containingPeriodStart('2026-08-01', 1, 1)).toBe('2026-08-01');
    expect(containingPeriodStart('2026-08-01', 1, 7)).toBe('2026-08-01');
  });

  it('trimestral anclada en enero: los tres meses del trimestre dan el mismo inicio', () => {
    expect(containingPeriodStart('2026-01-01', 3, 1)).toBe('2026-01-01');
    expect(containingPeriodStart('2026-02-01', 3, 1)).toBe('2026-01-01');
    expect(containingPeriodStart('2026-03-01', 3, 1)).toBe('2026-01-01');
    expect(containingPeriodStart('2026-04-01', 3, 1)).toBe('2026-04-01');
  });

  it('trimestral anclada en febrero: la serie se corre un mes', () => {
    expect(containingPeriodStart('2026-02-01', 3, 2)).toBe('2026-02-01');
    expect(containingPeriodStart('2026-04-01', 3, 2)).toBe('2026-02-01');
    expect(containingPeriodStart('2026-05-01', 3, 2)).toBe('2026-05-01');
  });

  it('CRUZA EL AÑO HACIA ATRÁS: enero puede pertenecer a un período que empezó en noviembre', () => {
    // Ancla en noviembre, trimestral: la serie es feb, may, ago, nov. Enero de 2027 cae
    // dentro del período que empezó en noviembre de 2026.
    expect(containingPeriodStart('2027-01-01', 3, 11)).toBe('2026-11-01');
    expect(containingPeriodStart('2026-12-01', 3, 11)).toBe('2026-11-01');
    expect(containingPeriodStart('2027-02-01', 3, 11)).toBe('2027-02-01');
  });

  it('semestral y anual', () => {
    expect(containingPeriodStart('2026-06-01', 6, 1)).toBe('2026-01-01');
    expect(containingPeriodStart('2026-07-01', 6, 1)).toBe('2026-07-01');

    // Anual anclada en septiembre: todo el año corre de septiembre a agosto.
    expect(containingPeriodStart('2026-09-01', 12, 9)).toBe('2026-09-01');
    expect(containingPeriodStart('2027-08-01', 12, 9)).toBe('2026-09-01');
    expect(containingPeriodStart('2027-09-01', 12, 9)).toBe('2027-09-01');
  });
});

describe('startsPeriod', () => {
  it('una regla mensual empieza período todos los meses', () => {
    expect(startsPeriod('2026-05-01', 1, 3)).toBe(true);
  });

  it('una trimestral solo en su ancla y cada tres meses desde ahí', () => {
    expect(startsPeriod('2026-02-01', 3, 2)).toBe(true);
    expect(startsPeriod('2026-03-01', 3, 2)).toBe(false);
    expect(startsPeriod('2026-11-01', 3, 2)).toBe(true);
  });

  it('una anual, un solo mes al año', () => {
    expect(startsPeriod('2026-09-01', 12, 9)).toBe(true);
    expect(startsPeriod('2026-10-01', 12, 9)).toBe(false);
  });
});
