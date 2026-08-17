import type { OutboxState } from '../../offline/db';
import type { OutboxEntry } from '../../offline/outbox';

/**
 * Cómo se lee la cola de salida.
 *
 * Son dos estados y nada más (`OutboxState`), y la diferencia entre ellos es la única
 * cosa que esta pantalla tiene que decir bien: una entrada en cola se resuelve sola
 * cuando vuelva la red, y una rechazada no se resuelve nunca sin que alguien la abra.
 * Por eso el rechazo se dibuja con el amarillo de "esto espera a una persona" —el mismo
 * de `status-pill--signed` y `status-pill--overdue`— y no con el verde de lo que va bien.
 */
export function stateLabel(state: OutboxState): string {
  return state === 'rejected' ? 'Rejected by the server' : 'Waiting to send';
}

export function statePillClass(state: OutboxState): string {
  return state === 'rejected'
    ? 'status-pill status-pill--overdue'
    : 'status-pill status-pill--signed';
}

/**
 * Los intentos, en palabras. `0` es un caso real y frecuente —la entrada recién firmada
 * que todavía no tuvo su primera corrida— y decir "0 attempts" ahí suena a que algo no
 * funcionó cuando lo único que pasó es que no pasó nada todavía.
 */
export function attemptsLabel(attempts: number): string {
  if (attempts === 0) return 'Not tried yet';

  return `${attempts} attempt${attempts === 1 ? '' : 's'}`;
}

/**
 * Lo rechazado primero.
 *
 * Las dos mitades de la lista piden cosas distintas: lo rechazado pide que el inspector
 * lo abra y lo arregle, lo encolado pide que espere. Mezclados por orden de llegada, el
 * trabajo que pide una persona se esconde entre el que no pide nada — y este dispositivo
 * puede acumular entradas de varios días (ADR-001).
 *
 * Dentro de cada mitad manda el día en que se empezó, del más viejo al más nuevo: el más
 * viejo es el que lleva más tiempo sin llegar al servidor.
 */
export function byUrgency(entries: readonly OutboxEntry[]): OutboxEntry[] {
  return [...entries].sort((a, b) => {
    if (a.row.state !== b.row.state) return a.row.state === 'rejected' ? -1 : 1;

    return a.draft.created_at.localeCompare(b.draft.created_at);
  });
}

/** Cuántas esperan y cuántas fueron rechazadas, para la tira de números del encabezado. */
export function tally(entries: readonly OutboxEntry[]): {
  queued: number;
  rejected: number;
} {
  const rejected = entries.filter(
    (entry) => entry.row.state === 'rejected',
  ).length;

  return { queued: entries.length - rejected, rejected };
}
