import { describe, expect, it } from 'vitest';
import type { InspectorOption, ScheduledInspection } from '@hs/contracts';

import {
  candidateLabel,
  inspectorLabel,
  isUnassigned,
  periodLabel,
  statusClass,
  STATUS_LABELS,
  unassignedNotice,
} from './scheduling-presentation';

const SITE = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function inspection(overrides: Partial<ScheduledInspection> = {}): ScheduledInspection {
  return {
    id: '44444444-4444-4444-8444-444444444444',
    site_id: SITE,
    period_start: '2026-08-01',
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

describe('el período', () => {
  it('se lee por mes', () => {
    expect(periodLabel('2026-08-01')).toBe('2026-08');
  });
});
