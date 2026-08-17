import { describe, expect, it } from 'vitest';

import type { OutboxEntry } from '../../offline/outbox';
import {
  attemptsLabel,
  byUrgency,
  statePillClass,
  stateLabel,
  tally,
} from './presentation';

function entry(
  id: string,
  state: 'queued' | 'rejected',
  createdAt: string,
): OutboxEntry {
  return {
    row: {
      client_submission_id: id,
      state,
      attempts: 0,
      next_attempt_at: 0,
      last_error: null,
      sending_since: null,
      lock_owner: null,
    },
    draft: { created_at: createdAt } as OutboxEntry['draft'],
  };
}

describe('stateLabel', () => {
  /**
   * "Waiting to send" no es lo mismo que "Rejected": la primera se arregla con red y la
   * segunda con una persona. Es la única distinción que esta pantalla existe para hacer.
   */
  it('distingue lo que espera red de lo que espera una persona', () => {
    expect(stateLabel('queued')).toBe('Waiting to send');
    expect(stateLabel('rejected')).toBe('Rejected by the server');
  });

  it('no dibuja un rechazo con el color de lo que va bien', () => {
    expect(statePillClass('rejected')).toContain('status-pill--overdue');
    expect(statePillClass('queued')).toContain('status-pill--signed');
  });
});

describe('attemptsLabel', () => {
  it('no dice "0 attempts" en algo que todavía no se intentó', () => {
    expect(attemptsLabel(0)).toBe('Not tried yet');
    expect(attemptsLabel(1)).toBe('1 attempt');
    expect(attemptsLabel(4)).toBe('4 attempts');
  });
});

describe('byUrgency', () => {
  it('pone lo rechazado arriba y ordena cada mitad por antigüedad', () => {
    const sorted = byUrgency([
      entry('a', 'queued', '2026-08-10T10:00:00Z'),
      entry('b', 'rejected', '2026-08-12T10:00:00Z'),
      entry('c', 'queued', '2026-08-08T10:00:00Z'),
      entry('d', 'rejected', '2026-08-05T10:00:00Z'),
    ]);

    expect(sorted.map((item) => item.row.client_submission_id)).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
  });

  it('no toca la lista que recibe', () => {
    const entries = [
      entry('a', 'queued', '2026-08-10T10:00:00Z'),
      entry('b', 'rejected', '2026-08-12T10:00:00Z'),
    ];
    byUrgency(entries);

    expect(entries.map((item) => item.row.client_submission_id)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('tally', () => {
  it('cuenta las dos mitades por separado', () => {
    expect(
      tally([
        entry('a', 'queued', '2026-08-10T10:00:00Z'),
        entry('b', 'rejected', '2026-08-12T10:00:00Z'),
        entry('c', 'queued', '2026-08-08T10:00:00Z'),
      ]),
    ).toEqual({ queued: 2, rejected: 1 });

    expect(tally([])).toEqual({ queued: 0, rejected: 0 });
  });
});
