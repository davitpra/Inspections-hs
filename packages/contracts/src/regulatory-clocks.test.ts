import { describe, expect, it } from 'vitest';

import {
  INCIDENT_CLASSIFICATIONS,
  WSIB_FORM7_BUSINESS_DAYS,
  type IncidentClassification,
  type RegulatoryClock,
  addBusinessDays,
  isBusinessDay,
  isClockOverdue,
  ontarioStatutoryHolidays,
  regulatoryClocks,
} from './index.js';

const OCCURRED = new Date('2026-03-02T08:00:00-05:00');
const REPORTED = new Date('2026-03-02T09:00:00-05:00');

function clocksFor(
  classification: IncidentClassification,
  occurredAt = OCCURRED,
  reportedAt = REPORTED,
): readonly RegulatoryClock[] {
  return regulatoryClocks({ classification, occurredAt, reportedAt });
}

function obligationsOf(clocks: readonly RegulatoryClock[]): string[] {
  return clocks.map((clock) => clock.obligation).sort();
}

describe('qué obligaciones dispara cada clasificación', () => {
  const CASES: ReadonlyArray<[IncidentClassification, string[]]> = [
    ['first_aid', []],
    ['health_care', ['mlitsd_written_notice', 'wsib_form7']],
    ['lost_time_or_modified_work', ['mlitsd_written_notice', 'wsib_form7']],
    ['critical_injury', ['mlitsd_immediate_notice', 'mlitsd_written_report', 'wsib_form7']],
    ['occupational_illness', ['mlitsd_written_notice', 'wsib_form7']],
  ];

  for (const [classification, expected] of CASES) {
    it(`${classification} dispara ${expected.length === 0 ? 'ninguna' : expected.join(', ')}`, () => {
      expect(obligationsOf(clocksFor(classification))).toEqual([...expected].sort());
    });
  }

  it('cubre las cinco clasificaciones', () => {
    expect(CASES.map(([classification]) => classification)).toEqual([...INCIDENT_CLASSIFICATIONS]);
  });

  it('los primeros auxilios no disparan nada, ni MLITSD ni Form 7', () => {
    expect(clocksFor('first_aid')).toEqual([]);
  });

  it('todo reloj lleva su cita normativa', () => {
    for (const classification of INCIDENT_CLASSIFICATIONS) {
      for (const clock of clocksFor(classification)) {
        expect(clock.citation.length).toBeGreaterThan(10);
      }
    }
  });
});

describe('la lesión crítica', () => {
  const clocks = clocksFor('critical_injury');

  it('el aviso inmediato no tiene plazo y no se muestra vencido nunca', () => {
    const immediate = clocks.find((clock) => clock.obligation === 'mlitsd_immediate_notice');

    expect(immediate?.immediate).toBe(true);
    expect(immediate?.dueAt).toBeNull();
    expect(isClockOverdue(immediate as RegulatoryClock, new Date('2030-01-01T00:00:00Z'))).toBe(
      false,
    );
  });

  it('el informe escrito vence 48 horas después del evento', () => {
    const written = clocks.find((clock) => clock.obligation === 'mlitsd_written_report');

    expect(written?.countsFrom).toBe('occurrence');
    expect(written?.dueAt?.toISOString()).toBe(new Date('2026-03-04T08:00:00-05:00').toISOString());
  });
});

describe('el aviso escrito de los cuatro días', () => {
  it('el tiempo perdido cuenta desde el evento', () => {
    const notice = clocksFor('lost_time_or_modified_work').find(
      (clock) => clock.obligation === 'mlitsd_written_notice',
    );

    expect(notice?.countsFrom).toBe('occurrence');
    expect(notice?.dueAt?.toISOString()).toBe(new Date('2026-03-06T08:00:00-05:00').toISOString());
  });

  it('la atención médica cuenta desde el evento', () => {
    const notice = clocksFor('health_care').find(
      (clock) => clock.obligation === 'mlitsd_written_notice',
    );

    expect(notice?.countsFrom).toBe('occurrence');
  });

  /**
   * La excepción de la tabla: la enfermedad ocupacional no tiene un instante de
   * ocurrencia que alguien pueda fijar, y la OHSA s. 52(2) la cuenta desde que al
   * empleador se le avisa. Contarla desde `occurred_at` haría que todo caso
   * reportado meses después de su inicio naciera vencido.
   */
  it('la enfermedad ocupacional cuenta desde el reporte, no desde el evento', () => {
    const notice = clocksFor(
      'occupational_illness',
      new Date('2025-11-01T08:00:00-04:00'),
      new Date('2026-03-02T09:00:00-05:00'),
    ).find((clock) => clock.obligation === 'mlitsd_written_notice');

    expect(notice?.countsFrom).toBe('report');
    expect(notice?.dueAt?.toISOString()).toBe(new Date('2026-03-06T09:00:00-05:00').toISOString());
  });
});

describe('el reporte tardío', () => {
  const occurredAt = new Date('2026-03-02T08:00:00-05:00');
  const reportedAt = new Date('2026-03-10T09:00:00-04:00');
  const now = new Date('2026-03-10T10:00:00-04:00');

  const clocks = clocksFor('critical_injury', occurredAt, reportedAt);

  it('deja los relojes del MLITSD ya vencidos', () => {
    const written = clocks.find((clock) => clock.obligation === 'mlitsd_written_report');

    expect(isClockOverdue(written as RegulatoryClock, now)).toBe(true);
  });

  it('y el del WSIB recién arrancando', () => {
    const form7 = clocks.find((clock) => clock.obligation === 'wsib_form7');

    expect(form7?.from.toISOString()).toBe(reportedAt.toISOString());
    expect(isClockOverdue(form7 as RegulatoryClock, now)).toBe(false);
  });

  it('los dos orígenes conviven en el mismo incidente', () => {
    expect(new Set(clocks.map((clock) => clock.countsFrom))).toEqual(
      new Set(['occurrence', 'report']),
    );
  });
});

describe('los tres días hábiles del Form 7', () => {
  it('son tres', () => {
    expect(WSIB_FORM7_BUSINESS_DAYS).toBe(3);
  });

  // Jueves 5 de marzo de 2026 → viernes 6, lunes 9, martes 10.
  it('cruzando un fin de semana', () => {
    const reportedAt = new Date('2026-03-05T10:00:00-05:00');
    const form7 = clocksFor('health_care', reportedAt, reportedAt).find(
      (clock) => clock.obligation === 'wsib_form7',
    );

    expect(form7?.dueAt?.toISOString()).toBe(new Date('2026-03-10T10:00:00-04:00').toISOString());
  });

  // Lunes 29 de junio de 2026 → martes 30, (Canada Day miércoles 1 NO cuenta),
  // jueves 2, viernes 3.
  it('cruzando Canada Day', () => {
    const reportedAt = new Date('2026-06-29T10:00:00-04:00');
    const form7 = clocksFor('health_care', reportedAt, reportedAt).find(
      (clock) => clock.obligation === 'wsib_form7',
    );

    expect(form7?.dueAt?.toISOString()).toBe(new Date('2026-07-03T10:00:00-04:00').toISOString());
  });

  it('un reporte del viernes vence el miércoles', () => {
    const reportedAt = new Date('2026-03-06T14:30:00-05:00');

    expect(addBusinessDays(reportedAt, 3).toISOString()).toBe(
      new Date('2026-03-11T14:30:00-04:00').toISOString(),
    );
  });

  it('conserva la hora del día a través del cambio de horario', () => {
    // El adelanto de Ontario de 2026 es el domingo 8 de marzo.
    const reportedAt = new Date('2026-03-05T10:00:00-05:00');
    const due = addBusinessDays(reportedAt, 3);

    expect(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Toronto',
        hourCycle: 'h23',
        hour: '2-digit',
        minute: '2-digit',
      }).format(due),
    ).toBe('10:00');
  });
});

describe('los feriados estatutarios de Ontario', () => {
  it('son nueve por año', () => {
    for (const year of [2026, 2027, 2028, 2029, 2030]) {
      expect(ontarioStatutoryHolidays(year)).toHaveLength(9);
    }
  });

  it('los cuatro de fecha fija no se mueven', () => {
    const holidays = ontarioStatutoryHolidays(2027);

    for (const fixed of ['2027-01-01', '2027-07-01', '2027-12-25', '2027-12-26']) {
      expect(holidays).toContain(fixed);
    }
  });

  it('el Viernes Santo se mueve año a año', () => {
    // Pascua occidental: 2026-04-05, 2027-03-28, 2028-04-16.
    expect(ontarioStatutoryHolidays(2026)).toContain('2026-04-03');
    expect(ontarioStatutoryHolidays(2027)).toContain('2027-03-26');
    expect(ontarioStatutoryHolidays(2028)).toContain('2028-04-14');
  });

  it('Family Day es el tercer lunes de febrero', () => {
    expect(ontarioStatutoryHolidays(2026)).toContain('2026-02-16');
    expect(ontarioStatutoryHolidays(2027)).toContain('2027-02-15');
  });

  it('Victoria Day es el lunes anterior al 25 de mayo', () => {
    expect(ontarioStatutoryHolidays(2026)).toContain('2026-05-18');
    // En 2027 el 25 de mayo cae martes, así que el lunes anterior es el 24.
    expect(ontarioStatutoryHolidays(2027)).toContain('2027-05-24');
  });

  it('Labour Day es el primer lunes de septiembre y Thanksgiving el segundo de octubre', () => {
    expect(ontarioStatutoryHolidays(2026)).toContain('2026-09-07');
    expect(ontarioStatutoryHolidays(2026)).toContain('2026-10-12');
  });

  it('un feriado no es día hábil, y el fin de semana tampoco', () => {
    expect(isBusinessDay('2026-07-01')).toBe(false); // Canada Day, miércoles
    expect(isBusinessDay('2026-07-04')).toBe(false); // sábado
    expect(isBusinessDay('2026-07-05')).toBe(false); // domingo
    expect(isBusinessDay('2026-07-02')).toBe(true);
  });

  it('no se corre el feriado que cae en fin de semana', () => {
    // El 1 de enero de 2028 cae sábado y sigue siendo el feriado, sin lunes de reemplazo.
    expect(ontarioStatutoryHolidays(2028)).toContain('2028-01-01');
    expect(ontarioStatutoryHolidays(2028)).not.toContain('2028-01-03');
  });
});

/**
 * Que el módulo no lea el reloj ambiente ni importe builtins de Node **no se prueba
 * acá**: lo aplica `forbidImpureDomainRules` en `eslint.config.js`, igual que la
 * pureza de `packages/forms`. Un test que leyera su propio fuente con `node:fs`
 * violaría la garantía que dice comprobar. Lo que sí se prueba acá es la consecuencia
 * observable: el resultado depende solo de las entradas.
 */
describe('ADR-008: las reglas se calculan sin estado externo', () => {
  it('el mismo incidente da el mismo resultado cada vez que se calcula', () => {
    const first = clocksFor('critical_injury');
    const second = clocksFor('critical_injury');

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
