import { describe, expect, it } from 'vitest';

import { completedInspections, recentCompleted } from './inspections';

describe('lo completado por este inspector', () => {
  function scheduled(overrides: Record<string, unknown> = {}) {
    return {
      id: 's-1',
      site_id: 'site-1',
      period_start: '2026-06-01',
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
