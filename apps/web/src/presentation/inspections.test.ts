import { describe, expect, it } from 'vitest';

import {
  assignmentState,
  completedInspections,
  dueIn,
  readiness,
  recentCompleted,
} from './inspections';

describe('readiness', () => {
  it('distingue no saber de no estar lista', () => {
    expect(readiness([])).toBe('ready');
    expect(readiness(['roster'])).toBe('not-ready');
    expect(readiness(undefined)).toBe('unknown');
  });
});

describe('dueIn', () => {
  it('cuenta los días que faltan', () => {
    expect(dueIn('2026-08-30', '2026-08-15')).toBe('in 15 days');
    expect(dueIn('2026-08-16', '2026-08-15')).toBe('in 1 day');
  });

  it('hoy es hoy, no "en 0 días"', () => {
    expect(dueIn('2026-08-15', '2026-08-15')).toBe('Due today');
  });

  it('lo vencido se lee para atrás', () => {
    expect(dueIn('2026-08-10', '2026-08-15')).toBe('5 days overdue');
    expect(dueIn('2026-08-14', '2026-08-15')).toBe('1 day overdue');
  });
});

describe('assignmentState', () => {
  it('sin saber si el paquete está, no ofrece ninguna acción', () => {
    const state = assignmentState({ readiness: 'unknown', overdue: false, draftStatus: null });

    expect(state.action).toBe('none');
    expect(state.pillLabel).toBe('');
  });

  it('falta el paquete: descargar, no empezar', () => {
    const state = assignmentState({ readiness: 'not-ready', overdue: false, draftStatus: null });

    expect(state).toMatchObject({ action: 'download', actionLabel: 'Download for the field' });
  });

  it('listo y sin borrador: empezar', () => {
    const state = assignmentState({ readiness: 'ready', overdue: false, draftStatus: null });

    expect(state).toMatchObject({ action: 'start', actionLabel: 'Start inspection' });
  });

  it('con un borrador a medias: retomar', () => {
    const state = assignmentState({
      readiness: 'ready',
      overdue: false,
      draftStatus: 'capturing',
    });

    expect(state).toMatchObject({ action: 'resume', actionLabel: 'Resume inspection' });
  });

  it('firmado y esperando: abrir, no volver a empezar', () => {
    const state = assignmentState({ readiness: 'ready', overdue: false, draftStatus: 'signed' });

    expect(state).toMatchObject({ action: 'open', actionLabel: 'Open inspection' });
  });

  it('con el paquete completo se ofrece volver a bajarlo, sin desplazar la acción', () => {
    for (const draftStatus of [null, 'capturing', 'signed'] as const) {
      const state = assignmentState({ readiness: 'ready', overdue: false, draftStatus });

      expect(state.showsRefresh).toBe(true);
      expect(state.action).not.toBe('download');
    }
  });

  it('no se ofrece refrescar lo que todavía no está, ni antes de saberlo', () => {
    for (const state of ['not-ready', 'unknown'] as const) {
      expect(
        assignmentState({ readiness: state, overdue: false, draftStatus: null }).showsRefresh,
      ).toBe(false);
    }
  });

  it('vencido gana en la píldora, nunca en la acción', () => {
    const state = assignmentState({ readiness: 'ready', overdue: true, draftStatus: null });

    expect(state).toMatchObject({
      action: 'start',
      actionLabel: 'Start inspection',
      pillLabel: 'Overdue',
    });
  });
});

describe('lo completado por este inspector', () => {
  function scheduled(overrides: Record<string, unknown> = {}) {
    return {
      id: 's-1',
      site_id: 'site-1',
      period_start: '2026-06-01',
      period_months: 1 as const,
      period_end: '2026-06-30',
      template_id: 't-1',
      template_name: 'Monthly general workplace inspection',
      template_version_id: 'v-1',
      template_version: 1,
      inspector_id: 'user-1',
      inspector_name: 'Marie Tremblay',
      scheduled_at: '2026-06-01T00:00:00.000Z',
      scheduled_by: null,
      cancelled_at: null,
      cancellation_reason: null,
      visible_early: false,
      status: 'completed' as const,
      inspection_id: 'insp-1',
      completed_at: '2026-06-28T18:00:00.000Z',
      ...overrides,
    };
  }

  it('excluye lo que no es de este inspector y lo que no está completado', () => {
    const items = [
      scheduled({ id: 'mine', inspector_id: 'user-1', status: 'completed' }),
      scheduled({ id: 'other-inspector', inspector_id: 'user-2', status: 'completed' }),
      scheduled({ id: 'still-open', inspector_id: 'user-1', status: 'open' }),
    ];

    expect(completedInspections(items, 'user-1').map((item) => item.id)).toEqual(['mine']);
  });

  it('lo más reciente primero, sin recortar', () => {
    const items = [
      scheduled({ id: 'may', period_start: '2026-05-01' }),
      scheduled({ id: 'july', period_start: '2026-07-01' }),
      scheduled({ id: 'june', period_start: '2026-06-01' }),
    ];

    expect(completedInspections(items, 'user-1').map((item) => item.id)).toEqual([
      'july',
      'june',
      'may',
    ]);
  });

  it('la tarjeta de inicio recorta al límite; la definición de "completado" es la misma', () => {
    const items = [
      scheduled({ id: 'may', period_start: '2026-05-01' }),
      scheduled({ id: 'july', period_start: '2026-07-01' }),
      scheduled({ id: 'june', period_start: '2026-06-01' }),
    ];

    expect(recentCompleted(items, 'user-1', 2).map((item) => item.id)).toEqual(['july', 'june']);
  });
});
