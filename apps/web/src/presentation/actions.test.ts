import { describe, expect, it } from 'vitest';
import { ACTION_STATES, type ActionState } from '@hs/contracts';

import {
  actionDeadlineStatus,
  ACTION_DEADLINE_LABEL,
  escalationSummary,
  STATE_LABELS,
  transitionLabel,
} from './actions';

describe('cómo se nombran las acciones correctivas', () => {
  it('cubre los estados del contrato y ninguno de más', () => {
    const known = Object.keys(STATE_LABELS) as ActionState[];

    expect([...known].sort()).toEqual([...ACTION_STATES].sort());
  });

  /**
   * El caso por el que las etiquetas van por PAR: las dos transiciones llegan a
   * `in_progress` y son cosas distintas — "empezar" y "devolver el trabajo".
   */
  it('el botón se nombra por par y no por destino', () => {
    expect(transitionLabel('open', 'in_progress')).toBe('Start work');
    expect(transitionLabel('awaiting_verification', 'in_progress')).toBe('Send it back');
  });

  it('un par sin texto propio cae en la etiqueta del estado destino', () => {
    expect(transitionLabel('closed', 'open')).toBe(STATE_LABELS.open);
  });

  it('nombra un plazo vencido solo mientras la acción sigue abierta', () => {
    expect(ACTION_DEADLINE_LABEL).toBe('Due date');
    expect(actionDeadlineStatus(true, 'in_progress')).toBe('Overdue');
    expect(actionDeadlineStatus(true, 'closed')).toBeNull();
    expect(actionDeadlineStatus(false, 'open')).toBeNull();
  });

  it('resume los escalamientos en el orden registrado', () => {
    expect(
      escalationSummary([
        { level: 'supervisor', days_overdue: 1, escalated_at: '2027-08-31T12:00:00Z' },
        { level: 'management', days_overdue: 3, escalated_at: '2027-09-02T12:00:00Z' },
      ]),
    ).toBe('Sent to supervisor (1 days late), management (3 days late)');
    expect(escalationSummary([])).toBeNull();
  });
});
