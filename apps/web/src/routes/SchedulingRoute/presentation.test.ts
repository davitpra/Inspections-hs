import { describe, expect, it } from 'vitest';
import type { InspectionSchedule, InspectorOption, ScheduledInspection } from '@hs/contracts';

import {
  candidateLabel,
  currentPeriod,
  currentRules,
  earliestEligibleYear,
  inspectorLabel,
  isUnassigned,
  missedNote,
  projectYear,
  ruleOwesPeriod,
  startsPeriod,
  statusClass,
  statusPillClass,
  STATUS_LABELS,
  unassignedNotice,
  yearStats,
  type YearEntry,
} from './presentation';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function inspection(overrides: Partial<ScheduledInspection> = {}): ScheduledInspection {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    site_id: SITE,
    period_start: '2026-08-01',
    period_months: 1,
    period_end: '2026-08-31',
    template_id: '55555555-5555-4555-8555-555555555555',
    template_name: 'Monthly general workplace inspection',
    template_version_id: '66666666-6666-4666-8666-666666666666',
    template_version: 2,
    inspector_id: USER,
    inspector_name: 'Dana Okafor',
    scheduled_at: '2026-08-01T07:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    status: 'open',
    inspection_id: null,
    completed_at: null,
    ...overrides,
  };
}

function candidate(overrides: Partial<InspectorOption> = {}): InspectorOption {
  return {
    id: USER,
    employee_number: 'E-4471',
    first_name: 'Dana',
    last_name: 'Okafor',
    ...overrides,
  };
}

const TEMPLATE_A = '55555555-5555-4555-8555-555555555555';
const TEMPLATE_B = '77777777-7777-4777-8777-777777777777';

function rule(overrides: Partial<InspectionSchedule> = {}): InspectionSchedule {
  return {
    id: '88888888-8888-4888-8888-888888888888',
    site_id: SITE,
    template_id: TEMPLATE_A,
    template_name: 'Monthly general workplace inspection',
    frequency_months: 1,
    anchor_month: 1,
    default_inspector_id: null,
    default_inspector_name: null,
    created_at: '2020-01-01T00:00:00.000Z',
    deactivated_at: null,
    ...overrides,
  };
}

describe('la fila vigente por plantilla', () => {
  it('devuelve la única regla cuando no hay historial', () => {
    expect(currentRules([rule()])).toEqual([rule()]);
  });

  // El caso de la captura: desactivar y crear de nuevo deja filas viejas dando vueltas.
  it('entre varias desactivadas de la misma plantilla, se queda con la más reciente', () => {
    const oldest = rule({ id: 'a', deactivated_at: '2026-01-01T00:00:00.000Z' });
    const middle = rule({ id: 'b', deactivated_at: '2026-03-01T00:00:00.000Z' });
    const newest = rule({ id: 'c', deactivated_at: '2026-06-01T00:00:00.000Z' });

    expect(currentRules([oldest, newest, middle])).toEqual([newest]);
  });

  it('una regla activa gana siempre, sin importar el orden', () => {
    const active = rule({ id: 'active', deactivated_at: null });
    const deactivated = rule({ id: 'old', deactivated_at: '2026-06-01T00:00:00.000Z' });

    expect(currentRules([deactivated, active])).toEqual([active]);
  });

  it('no mezcla plantillas distintas', () => {
    const a = rule({ id: 'a', template_id: TEMPLATE_A });
    const b = rule({ id: 'b', template_id: TEMPLATE_B });

    expect(currentRules([a, b])).toEqual([a, b]);
  });
});

describe('el estado del período', () => {
  it('nombra los cuatro', () => {
    expect(Object.keys(STATUS_LABELS).sort()).toEqual([
      'cancelled',
      'completed',
      'missed',
      'open',
    ]);
  });

  // Las mismas clases que el reporte de cumplimiento: el mismo estado se ve igual en las
  // dos pantallas, o deja de significar lo mismo.
  it('usa las clases del reporte de cumplimiento', () => {
    expect(statusClass('completed')).toBe('period period--completed');
    expect(statusClass('missed')).toBe('period period--missed');
    expect(statusClass('cancelled')).toBe('period period--cancelled');
    expect(statusClass('open')).toBe('period period--open');
  });

  it('la píldora usa la misma paleta', () => {
    expect(statusPillClass('open')).toBe('status-pill status-pill--open');
    expect(statusPillClass('missed')).toBe('status-pill status-pill--missed');
  });
});

describe('el inspector de una fila', () => {
  it('nombra al asignado', () => {
    expect(inspectorLabel(inspection())).toBe('Dana Okafor');
  });

  // Lo que la consola existe para hacer visible.
  it('dice que no tiene inspector cuando no lo tiene', () => {
    expect(inspectorLabel(inspection({ inspector_id: null, inspector_name: null }))).toBe(
      'Unassigned',
    );
  });

  /**
   * El caso del aislamiento de `person`: la asignación es válida, la persona vive en la
   * otra planta y quien mira no la puede ver. Se dice; no se disimula con un UUID.
   */
  it('distingue "sin asignar" de "asignado pero sin nombre visible"', () => {
    const label = inspectorLabel(inspection({ inspector_name: null }));

    expect(label).not.toBe('Unassigned');
    expect(label).toContain('not visible');
  });
});

describe('el mes omitido', () => {
  it('dice que todavía se puede enviar', () => {
    const missed = inspection({ status: 'missed' });

    expect(missedNote(missed)).toMatch(/can still be submitted/);
  });

  it('sin inspector, lo que falta es asignarlo', () => {
    const missed = inspection({ status: 'missed', inspector_id: null, inspector_name: null });

    expect(missedNote(missed)).toMatch(/Assign an inspector/);
  });

  it('no dice nada sobre los otros tres estados', () => {
    for (const status of ['open', 'completed', 'cancelled'] as const) {
      expect(missedNote(inspection({ status }))).toBeNull();
    }
  });
});

describe('lo que no tiene inspector', () => {
  it('cuenta como pendiente de resolver', () => {
    expect(isUnassigned(inspection({ inspector_id: null }))).toBe(true);
    expect(isUnassigned(inspection())).toBe(false);
  });

  // Una cancelada sin inspector no es un problema: ya no se va a hacer.
  it('no cuenta la cancelada', () => {
    const cancelled = inspection({
      inspector_id: null,
      cancelled_at: '2026-08-05T12:00:00.000Z',
      status: 'cancelled',
    });

    expect(isUnassigned(cancelled)).toBe(false);
  });

  it('no avisa nada cuando están todas asignadas', () => {
    expect(unassignedNotice([inspection()])).toBeNull();
  });

  /**
   * El aviso dice lo que PASA, no solo el número: quien lo lee no tiene forma de saber
   * que una inspección sin inspector es invisible en todas las demás pantallas.
   */
  it('explica por qué importa, no solo cuántas son', () => {
    const notice = unassignedNotice([
      inspection({ id: 'a', inspector_id: null }),
      inspection({ id: 'b', inspector_id: null }),
      inspection(),
    ]);

    expect(notice).toContain('2 scheduled inspections');
    expect(notice).toContain("nobody's pending list");
  });

  it('concuerda en singular', () => {
    const notice = unassignedNotice([inspection({ inspector_id: null })]);

    expect(notice).toContain('1 scheduled inspection has');
  });
});

describe('el candidato en el selector', () => {
  // §4: el nombre NO identifica. Dos personas activas pueden llamarse igual.
  it('lleva el número de empleado al lado del nombre', () => {
    expect(candidateLabel(candidate())).toBe('Dana Okafor (E-4471)');
  });

  it('cae al número de empleado cuando la persona no es visible', () => {
    expect(candidateLabel(candidate({ first_name: null, last_name: null }))).toBe('E-4471');
  });

  it('cae al id cuando no hay nada más', () => {
    const bare = candidate({ first_name: null, last_name: null, employee_number: null });

    expect(candidateLabel(bare)).toBe(USER);
  });
});

describe('lo que una regla debe', () => {
  it('debe el mes en que se creó', () => {
    expect(ruleOwesPeriod(rule({ created_at: '2026-03-12T00:00:00.000Z' }), '2026-03-01')).toBe(
      true,
    );
  });

  it('no debe un mes anterior a su creación', () => {
    expect(ruleOwesPeriod(rule({ created_at: '2026-03-12T00:00:00.000Z' }), '2026-02-01')).toBe(
      false,
    );
  });

  it('sin desactivar, debe todo mes futuro', () => {
    expect(ruleOwesPeriod(rule({ created_at: '2020-01-01T00:00:00.000Z' }), '2030-01-01')).toBe(
      true,
    );
  });

  it('debe el mes en que se desactivó, no el siguiente', () => {
    const deactivated = rule({
      created_at: '2020-01-01T00:00:00.000Z',
      deactivated_at: '2026-09-15T00:00:00.000Z',
    });

    expect(ruleOwesPeriod(deactivated, '2026-09-01')).toBe(true);
    expect(ruleOwesPeriod(deactivated, '2026-10-01')).toBe(false);
  });

  it('resuelve la ventana en la zona de la planta', () => {
    // 2026-04-01T02:00:00Z es 2026-03-31 en America/Toronto: la regla ya debe marzo.
    const createdLate = rule({ created_at: '2026-04-01T02:00:00.000Z' });

    expect(ruleOwesPeriod(createdLate, '2026-03-01')).toBe(true);
  });
});

describe('el calendario de un año', () => {
  function unopened(entry: YearEntry): boolean {
    return entry.kind === 'unopened';
  }

  it('un año con una regla muestra doce entradas', () => {
    const activeRule = rule({ created_at: '2025-01-01T00:00:00.000Z' });
    const opened = Array.from({ length: 8 }, (_, index) =>
      inspection({
        id: `p-${index}`,
        period_start: `2026-${String(index + 1).padStart(2, '0')}-01`,
      }),
    );

    const entries = projectYear([activeRule], opened, '2026');

    expect(entries).toHaveLength(12);
    expect(entries.filter(unopened)).toHaveLength(4);
    expect(entries.filter((entry) => !unopened(entry))).toHaveLength(8);
  });

  it('un año futuro está enteramente sin abrir', () => {
    const activeRule = rule({ created_at: '2025-01-01T00:00:00.000Z' });

    const entries = projectYear([activeRule], [], '2027');

    expect(entries).toHaveLength(12);
    expect(entries.every(unopened)).toBe(true);
  });

  it('no proyecta un mes anterior a que la regla existiera', () => {
    const createdInMarch = rule({ created_at: '2026-03-15T00:00:00.000Z' });

    const entries = projectYear([createdInMarch], [], '2026');
    const months = entries.map((entry) =>
      entry.kind === 'unopened' ? entry.period.period_start : entry.inspection.period_start,
    );

    expect(months).not.toContain('2026-01-01');
    expect(months).not.toContain('2026-02-01');
    expect(months).toContain('2026-03-01');
  });

  it('no proyecta un mes posterior a que la regla se desactivara', () => {
    const deactivatedInSeptember = rule({
      created_at: '2020-01-01T00:00:00.000Z',
      deactivated_at: '2026-09-10T00:00:00.000Z',
    });

    const entries = projectYear([deactivatedInSeptember], [], '2026');
    const months = entries.map((entry) =>
      entry.kind === 'unopened' ? entry.period.period_start : entry.inspection.period_start,
    );

    expect(months).toContain('2026-09-01');
    expect(months).not.toContain('2026-10-01');
    expect(months).toHaveLength(9);
  });

  it('un período de una regla ya desactivada se sigue mostrando', () => {
    const deactivatedInSeptember = rule({
      created_at: '2020-01-01T00:00:00.000Z',
      deactivated_at: '2026-09-10T00:00:00.000Z',
    });
    const orphan = inspection({ id: 'orphan', period_start: '2026-10-01' });

    const entries = projectYear([deactivatedInSeptember], [orphan], '2026');
    const october = entries.find(
      (entry) => entry.kind === 'opened' && entry.inspection.id === 'orphan',
    );

    expect(october).toBeDefined();
  });

  it('una cancelada se lee cancelada, no como no abierta', () => {
    const activeRule = rule({ created_at: '2020-01-01T00:00:00.000Z' });
    const cancelled = inspection({
      period_start: '2026-05-01',
      status: 'cancelled',
      cancelled_at: '2026-05-02T00:00:00.000Z',
      cancellation_reason: 'Site closed',
    });

    const entries = projectYear([activeRule], [cancelled], '2026');
    const may = entries.find(
      (entry) => entry.kind === 'opened' && entry.inspection.period_start === '2026-05-01',
    );

    expect(may).toBeDefined();
    expect(may?.kind === 'opened' ? may.inspection.status : null).toBe('cancelled');
  });

  /**
   * Cancelar y volver a programar deja dos filas para el mismo mes. La viva es la del
   * calendario: si ganara la cancelada, el mes se vería muerto y el trabajo real —ya
   * programado, con inspector— no aparecería en ningún lado.
   */
  it('un mes cancelado y vuelto a programar muestra la fila viva, y una sola', () => {
    const activeRule = rule({ created_at: '2020-01-01T00:00:00.000Z' });
    const cancelled = inspection({
      id: 'cancelled',
      period_start: '2026-05-01',
      status: 'cancelled',
      cancelled_at: '2026-05-02T00:00:00.000Z',
      cancellation_reason: 'Site closed',
    });
    const reopened = inspection({ id: 'reopened', period_start: '2026-05-01' });

    // El orden de la respuesta no decide: la lista llega `period_start DESC` y dentro de
    // un mes no hay desempate declarado.
    for (const periods of [[cancelled, reopened], [reopened, cancelled]]) {
      const may = projectYear([activeRule], periods, '2026').filter(
        (entry) => entry.kind === 'opened' && entry.inspection.period_start === '2026-05-01',
      );

      expect(may.length).toBe(1);
      expect(may[0]?.kind === 'opened' ? may[0].inspection.id : null).toBe('reopened');
    }
  });

  it('entre puras canceladas se lee la última', () => {
    const first = inspection({
      id: 'first',
      status: 'cancelled',
      cancelled_at: '2026-08-02T00:00:00.000Z',
      cancellation_reason: 'Site closed',
    });
    const last = inspection({
      id: 'last',
      status: 'cancelled',
      cancelled_at: '2026-08-09T00:00:00.000Z',
      cancellation_reason: 'Strike',
    });

    expect(currentPeriod([first, last])?.id).toBe('last');
    expect(currentPeriod([last, first])?.id).toBe('last');
  });

  it('ordena de enero a diciembre y desempata por plantilla', () => {
    const ruleA = rule({ id: 'ra', template_id: TEMPLATE_A, created_at: '2020-01-01T00:00:00.000Z' });
    const ruleB = rule({
      id: 'rb',
      template_id: TEMPLATE_B,
      template_name: 'Fire extinguishers',
      created_at: '2020-01-01T00:00:00.000Z',
    });

    const entries = projectYear([ruleA, ruleB], [], '2026');

    expect(entries[0]?.kind === 'unopened' ? entries[0].period.period_start : null).toBe(
      '2026-01-01',
    );
    expect(entries[0]?.kind === 'unopened' ? entries[0].period.template_name : null).toBe(
      'Fire extinguishers',
    );
  });
});

describe('el año más antiguo al que se puede retroceder', () => {
  it('sin reglas ni períodos, es el año en curso', () => {
    expect(earliestEligibleYear([], [], '2026')).toBe('2026');
  });

  it('retrocede hasta la regla más vieja', () => {
    const oldRule = rule({ created_at: '2022-06-01T00:00:00.000Z' });

    expect(earliestEligibleYear([oldRule], [], '2026')).toBe('2022');
  });

  it('retrocede hasta el período más viejo', () => {
    const oldPeriod = inspection({ period_start: '2021-01-01' });

    expect(earliestEligibleYear([], [oldPeriod], '2026')).toBe('2021');
  });

  it('no retrocede más allá de lo que hay', () => {
    const recentRule = rule({ created_at: '2025-06-01T12:00:00.000Z' });

    expect(earliestEligibleYear([recentRule], [], '2026')).toBe('2025');
  });
});

describe('los conteos del pie del calendario', () => {
  it('reparte cada entrada en un solo cubo, y suman el total', () => {
    const entries: YearEntry[] = [
      { kind: 'unopened', period: {
          site_id: SITE,
          template_id: 't',
          template_name: 'x',
          period_start: '2026-01-01',
          period_months: 1,
        } },
      { kind: 'opened', inspection: inspection({ inspector_id: null, inspector_name: null }) },
      { kind: 'opened', inspection: inspection({ inspector_id: USER, inspector_name: 'Dana Okafor' }) },
    ];

    expect(yearStats(entries)).toEqual({ total: 3, assigned: 1, unassigned: 1, notOpened: 1 });
  });

  it('un período cancelado cuenta como resuelto, no como pendiente', () => {
    const cancelled = inspection({
      inspector_id: null,
      inspector_name: null,
      cancelled_at: '2026-08-05T00:00:00.000Z',
      cancellation_reason: 'Site closed',
      status: 'cancelled',
    });

    expect(yearStats([{ kind: 'opened', inspection: cancelled }])).toEqual({
      total: 1,
      assigned: 1,
      unassigned: 0,
      notOpened: 0,
    });
  });
});

/**
 * LOS MISMOS CASOS QUE `apps/api/src/inspections/period.spec.ts`.
 *
 * La aritmética del ancla vive en cuatro lugares —el CTE del reporte, el INSERT del
 * trabajo de apertura, `period.ts` del servidor y `startsPeriod` de acá— y no se puede
 * compartir código entre Postgres, Node y el navegador. Que estos casos estén escritos
 * dos veces es deliberado: es lo que hace que una divergencia falle en vez de producir un
 * calendario que muestra cuatro casillas donde el servidor abrió doce.
 */
describe('el ancla de la regla', () => {
  const quarterly = (anchor: number) =>
    rule({ frequency_months: 3, anchor_month: anchor });

  it('una regla mensual empieza período todos los meses', () => {
    expect(startsPeriod(rule({ frequency_months: 1, anchor_month: 3 }), '2026-05-01')).toBe(true);
  });

  it('trimestral anclada en enero: el trimestre civil', () => {
    expect(startsPeriod(quarterly(1), '2026-01-01')).toBe(true);
    expect(startsPeriod(quarterly(1), '2026-02-01')).toBe(false);
    expect(startsPeriod(quarterly(1), '2026-04-01')).toBe(true);
  });

  it('trimestral anclada en febrero: la serie se corre un mes', () => {
    expect(startsPeriod(quarterly(2), '2026-02-01')).toBe(true);
    expect(startsPeriod(quarterly(2), '2026-03-01')).toBe(false);
    expect(startsPeriod(quarterly(2), '2026-11-01')).toBe(true);
  });

  it('CRUZA EL AÑO: con ancla en noviembre, febrero sigue la serie', () => {
    expect(startsPeriod(quarterly(11), '2026-11-01')).toBe(true);
    expect(startsPeriod(quarterly(11), '2027-02-01')).toBe(true);
    expect(startsPeriod(quarterly(11), '2027-01-01')).toBe(false);
  });

  it('anual: un solo mes al año', () => {
    const annual = rule({ frequency_months: 12, anchor_month: 9 });

    expect(startsPeriod(annual, '2026-09-01')).toBe(true);
    expect(startsPeriod(annual, '2026-10-01')).toBe(false);
    expect(startsPeriod(annual, '2027-09-01')).toBe(true);
  });
});

describe('el calendario de una regla no mensual', () => {
  it('una regla trimestral proyecta cuatro casillas al año, no doce', () => {
    const entries = projectYear([rule({ frequency_months: 3, anchor_month: 1 })], [], '2026');

    expect(entries).toHaveLength(4);
    expect(
      entries.map((entry) => (entry.kind === 'unopened' ? entry.period.period_start : null)),
    ).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
  });

  it('una regla anual proyecta una sola, en su mes ancla', () => {
    const entries = projectYear([rule({ frequency_months: 12, anchor_month: 9 })], [], '2026');

    const only = entries[0];

    expect(entries).toHaveLength(1);
    expect(only?.kind === 'unopened' && only.period.period_start).toBe('2026-09-01');
  });

  it('la casilla sin abrir lleva el largo de la regla, para poder nombrarse', () => {
    const entries = projectYear([rule({ frequency_months: 3, anchor_month: 1 })], [], '2026');
    const first = entries[0];

    expect(first?.kind).toBe('unopened');
    expect(first?.kind === 'unopened' && first.period.period_months).toBe(3);
  });
});
