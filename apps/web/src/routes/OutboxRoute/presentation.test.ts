import { describe, expect, it } from 'vitest';

import type { DeviceWork } from '../../offline/outbox';
import {
  attemptsLabel,
  byUrgency,
  statePillClass,
  stateLabel,
  tally,
} from './presentation';

/** Una entrada con fila de cola: firmada y en camino. */
function entry(
  id: string,
  state: 'queued' | 'rejected',
  createdAt: string,
): DeviceWork {
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
    draft: { client_submission_id: id, created_at: createdAt } as DeviceWork['draft'],
  };
}

/** Un borrador que todavía no se firmó: no hay fila de cola porque firmar es lo que la crea. */
function unsigned(id: string, createdAt: string): DeviceWork {
  return {
    row: null,
    draft: { client_submission_id: id, created_at: createdAt } as DeviceWork['draft'],
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

  /**
   * El tercer estado es la AUSENCIA de la fila de cola, y no puede leerse como una de las
   * dos anteriores: un borrador sin firmar no está esperando red ni fue rechazado, está
   * esperando que su dueño lo termine.
   */
  it('nombra lo que todavía no se firmó sin decir que espera red', () => {
    expect(stateLabel(null)).toBe('Not signed yet');
  });

  it('no dibuja un rechazo con el color de lo que va bien', () => {
    expect(statePillClass('rejected')).toContain('status-pill--overdue');
    expect(statePillClass('queued')).toContain('status-pill--signed');
  });

  /**
   * El mismo borrador visto desde la página de su asignación usa `draftStatusPill`, que
   * para `capturing` da `--draft`. Dos colores para una fila serían dos estados que no
   * existen.
   */
  it('pinta lo sin firmar como trabajo en curso y no como algo que espera salir', () => {
    expect(statePillClass(null)).toBe('status-pill status-pill--draft');
  });
});

describe('attemptsLabel', () => {
  it('no dice "0 attempts" en algo que todavía no se intentó', () => {
    expect(attemptsLabel(0)).toBe('Not tried yet');
    expect(attemptsLabel(1)).toBe('1 attempt');
    expect(attemptsLabel(4)).toBe('4 attempts');
  });

  /** Sin fila de cola no hubo intentos: no es que fallaron cero veces, es que no hubo qué. */
  it('calla en un borrador que no llegó a la cola', () => {
    expect(attemptsLabel(null)).toBeNull();
  });
});

describe('byUrgency', () => {
  it('pone lo rechazado arriba y ordena cada grupo por antigüedad', () => {
    const sorted = byUrgency([
      entry('a', 'queued', '2026-08-10T10:00:00Z'),
      entry('b', 'rejected', '2026-08-12T10:00:00Z'),
      entry('c', 'queued', '2026-08-08T10:00:00Z'),
      entry('d', 'rejected', '2026-08-05T10:00:00Z'),
    ]);

    expect(sorted.map((item) => item.draft.client_submission_id)).toEqual([
      'd',
      'b',
      'c',
      'a',
    ]);
  });

  /**
   * Lo sin firmar va ÚLTIMO aunque también pida una persona: lo rechazado es trabajo
   * terminado que se está por perder, y eso vence a un recorrido a medio hacer por viejo
   * que sea. El borrador de acá es el más antiguo de los tres y aun así va al final.
   */
  it('deja lo sin firmar debajo de todo lo que ya está en la cola', () => {
    const sorted = byUrgency([
      unsigned('u', '2026-07-01T10:00:00Z'),
      entry('q', 'queued', '2026-08-10T10:00:00Z'),
      entry('r', 'rejected', '2026-08-12T10:00:00Z'),
    ]);

    expect(sorted.map((item) => item.draft.client_submission_id)).toEqual(['r', 'q', 'u']);
  });

  it('ordena los borradores sin firmar entre sí por antigüedad', () => {
    const sorted = byUrgency([
      unsigned('nuevo', '2026-08-20T10:00:00Z'),
      unsigned('viejo', '2026-08-02T10:00:00Z'),
    ]);

    expect(sorted.map((item) => item.draft.client_submission_id)).toEqual(['viejo', 'nuevo']);
  });

  it('no toca la lista que recibe', () => {
    const entries = [
      entry('a', 'queued', '2026-08-10T10:00:00Z'),
      entry('b', 'rejected', '2026-08-12T10:00:00Z'),
    ];
    byUrgency(entries);

    expect(entries.map((item) => item.draft.client_submission_id)).toEqual(['a', 'b']);
  });
});

describe('tally', () => {
  it('cuenta los tres grupos por separado', () => {
    expect(
      tally([
        entry('a', 'queued', '2026-08-10T10:00:00Z'),
        entry('b', 'rejected', '2026-08-12T10:00:00Z'),
        entry('c', 'queued', '2026-08-08T10:00:00Z'),
        unsigned('d', '2026-08-01T10:00:00Z'),
      ]),
    ).toEqual({ queued: 2, rejected: 1, unsigned: 1 });

    expect(tally([])).toEqual({ queued: 0, rejected: 0, unsigned: 0 });
  });
});
