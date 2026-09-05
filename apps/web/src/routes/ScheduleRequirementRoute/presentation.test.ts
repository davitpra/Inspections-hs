import { describe, expect, it } from 'vitest';
import type { InspectionSchedule, ScheduledInspection } from '@hs/contracts';

import { canMakeVisible, requirementYear, rowNote, rowVisibility } from './presentation';
import type { YearEntry } from '../../presentation/scheduling';

const SITE = '11111111-1111-4111-8111-111111111111';
const TEMPLATE = '22222222-2222-4222-8222-222222222222';

function rule(overrides: Partial<InspectionSchedule> = {}): InspectionSchedule {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    site_id: SITE,
    template_id: TEMPLATE,
    template_name: 'Workplace inspection',
    frequency_months: 1,
    anchor_month: 1,
    default_inspector_id: null,
    default_inspector_name: null,
    created_at: '2020-01-01T00:00:00.000Z',
    deactivated_at: null,
    archived_at: null,
    ...overrides,
  };
}

function period(periodStart: string, visibleEarly = false): ScheduledInspection {
  return {
    id: `44444444-4444-4444-8444-${periodStart.slice(0, 4)}${periodStart.slice(5, 7)}000000`,
    site_id: SITE,
    period_start: periodStart,
    period_months: 1,
    period_end: `${periodStart.slice(0, 7)}-28`,
    template_id: TEMPLATE,
    template_name: 'Workplace inspection',
    template_version_id: '55555555-5555-4555-8555-555555555555',
    template_version: 2,
    inspector_id: null,
    inspector_name: null,
    scheduled_at: '2026-01-01T00:00:00.000Z',
    scheduled_by: null,
    cancelled_at: null,
    cancellation_reason: null,
    visible_early: visibleEarly,
    status: 'open',
    inspection_id: null,
    completed_at: null,
  };
}

function starts(entries: ReturnType<typeof requirementYear>): string[] {
  return entries.map((entry) => entry.kind === 'opened' ? entry.inspection.period_start : entry.period.period_start);
}

describe('proyección del plan de un requisito', () => {
  it('proyecta las cuatro frecuencias sin crear aritmética paralela', () => {
    expect(requirementYear(rule({ frequency_months: 1 }), [], '2026')).toHaveLength(12);
    expect(requirementYear(rule({ frequency_months: 6 }), [], '2026')).toHaveLength(2);
    expect(requirementYear(rule({ frequency_months: 3 }), [], '2026')).toHaveLength(4);
    expect(requirementYear(rule({ frequency_months: 12 }), [], '2026')).toHaveLength(1);
  });

  it('respeta un ancla trimestral que no es enero', () => {
    expect(starts(requirementYear(rule({ frequency_months: 3, anchor_month: 2 }), [], '2026'))).toEqual([
      '2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01',
    ]);
  });

  it('respeta la ventana de creación y desactivación', () => {
    const entries = requirementYear(rule({
      created_at: '2026-03-15T00:00:00.000Z',
      deactivated_at: '2026-09-15T00:00:00.000Z',
    }), [], '2026');

    expect(starts(entries)).toEqual(['2026-03-01', '2026-04-01', '2026-05-01', '2026-06-01', '2026-07-01', '2026-08-01', '2026-09-01']);
  });

  it('conserva un período programado que ya no reclama una regla vigente', () => {
    const entries = requirementYear(
      rule({ deactivated_at: '2026-09-15T00:00:00.000Z' }),
      [period('2026-10-01')],
      '2026',
    );

    expect(starts(entries)).toContain('2026-10-01');
    expect(entries.find((entry) => entry.kind === 'opened' && entry.inspection.period_start === '2026-10-01')).toBeDefined();
  });
});

function opened(inspection: ScheduledInspection): YearEntry {
  return { kind: 'opened', inspection };
}

describe('la nota de una fila abierta', () => {
  it('avisa la cancelación con su motivo', () => {
    const cancelled = { ...period('2026-12-01'), cancelled_at: '2026-08-10T00:00:00.000Z', cancellation_reason: 'Plant shutdown' };

    expect(rowNote(opened(cancelled))).toBe('Cancelled: Plant shutdown');
  });

  it('avisa el período que cerró sin inspección', () => {
    expect(rowNote(opened({ ...period('2026-02-01'), status: 'missed' }))).toContain('The period closed without an inspection');
  });

  it('no avisa nada sobre la visibilidad, que tiene su propia columna', () => {
    expect(rowNote(opened(period('2026-12-01', true)))).toBeNull();
    expect(rowNote(opened(period('2026-12-01', false)))).toBeNull();
  });
});

describe('la visibilidad actual de una fila', () => {
  it('muestra una inspección asignada cuando el período ya empezó', () => {
    const inspection = { ...period('2026-08-01'), inspector_id: '66666666-6666-4666-8666-666666666666' };

    expect(rowVisibility(opened(inspection), '2026-08-25')).toBe('Visible');
  });

  it('muestra antes de tiempo solo cuando se pidió visibilidad anticipada', () => {
    const inspector_id = '66666666-6666-4666-8666-666666666666';

    expect(rowVisibility(opened({ ...period('2026-12-01'), inspector_id }), '2026-08-25')).toBe('Not visible');
    expect(rowVisibility(opened({ ...period('2026-12-01', true), inspector_id }), '2026-08-25')).toBe('Visible');
  });

  it('no muestra períodos sin abrir, sin asignar, cancelados o completados', () => {
    const inspector_id = '66666666-6666-4666-8666-666666666666';
    const unopened = requirementYear(rule(), [], '2026')[0]!;

    expect(rowVisibility(unopened, '2026-08-25')).toBe('Not visible');
    expect(rowVisibility(opened(period('2026-08-01')), '2026-08-25')).toBe('Not visible');
    expect(rowVisibility(opened({ ...period('2026-08-01'), inspector_id, cancelled_at: '2026-08-10T00:00:00.000Z' }), '2026-08-25')).toBe('Not visible');
    expect(rowVisibility(opened({ ...period('2026-08-01'), inspector_id, status: 'completed' }), '2026-08-25')).toBe('Not visible');
  });
});

describe('la acción de adelantar visibilidad', () => {
  const inspector_id = '66666666-6666-4666-8666-666666666666';

  it('se ofrece al coordinador para una asignación futura todavía oculta', () => {
    expect(canMakeVisible(opened({ ...period('2026-12-01'), inspector_id }), '2026-08-25', true)).toBe(true);
  });

  it('no se ofrece sin permiso, asignación, futuro o registro activo', () => {
    const future = opened({ ...period('2026-12-01'), inspector_id });

    expect(canMakeVisible(future, '2026-08-25', false)).toBe(false);
    expect(canMakeVisible(opened(period('2026-12-01')), '2026-08-25', true)).toBe(false);
    expect(canMakeVisible(opened({ ...period('2026-08-01'), inspector_id }), '2026-08-25', true)).toBe(false);
    expect(canMakeVisible(opened({ ...period('2026-12-01', true), inspector_id }), '2026-08-25', true)).toBe(false);
    expect(canMakeVisible(opened({ ...period('2026-12-01'), inspector_id, status: 'completed' }), '2026-08-25', true)).toBe(false);
    expect(canMakeVisible(opened({ ...period('2026-12-01'), inspector_id, cancelled_at: '2026-08-10T00:00:00.000Z' }), '2026-08-25', true)).toBe(false);
  });
});
