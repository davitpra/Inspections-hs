import { describe, expect, it } from 'vitest';
import { ACTION_STATES, type ActionState } from '@hs/contracts';

import {
  decisionLabel,
  STATE_LABELS,
  transitionLabel,
  transitionTakesNote,
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

  /**
   * El registro y el botón son dos tiempos del mismo par: uno promete y el otro cuenta. Que
   * los textos sean distintos es la decisión que se comprueba acá.
   */
  it('el registro nombra el paso dado y no el botón que lo iba a dar', () => {
    expect(decisionLabel('open', 'in_progress')).toBe('Work started');
    expect(decisionLabel('in_progress', 'awaiting_verification')).toBe('Work declared done');
    expect(decisionLabel('awaiting_verification', 'in_progress')).toBe('Sent back');
    expect(decisionLabel('awaiting_verification', 'closed')).toBe('Verified and closed');
  });

  /** El alta llega sin origen, y ningún par la nombra. */
  it('un paso sin texto propio cae en la etiqueta del estado destino', () => {
    expect(decisionLabel(null, 'open')).toBe(STATE_LABELS.open);
  });

  /**
   * Empezar el trabajo no pide nada: la persona, la descripción y el plazo ya se escribieron
   * al crear la acción, y el paso se anuncia como "No additional information is required".
   */
  it('solo empezar el trabajo no admite nota', () => {
    expect(transitionTakesNote('open', 'in_progress')).toBe(false);
    expect(transitionTakesNote('in_progress', 'awaiting_verification')).toBe(true);
    expect(transitionTakesNote('awaiting_verification', 'closed')).toBe(true);
    expect(transitionTakesNote('awaiting_verification', 'in_progress')).toBe(true);
  });
});
