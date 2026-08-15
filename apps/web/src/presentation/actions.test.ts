import { describe, expect, it } from 'vitest';
import { ACTION_STATES, type ActionState } from '@hs/contracts';

import { STATE_LABELS, transitionLabel } from './actions';

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
});
