import type { OutboxState } from '../../offline/db';
import type { DeviceWork } from '../../offline/outbox';

/**
 * Cómo se lee lo que no salió de este dispositivo.
 *
 * Son TRES estados, y el tercero no es un estado de la cola sino su ausencia: un borrador
 * que todavía no se firmó no tiene fila de cola, y por eso el tipo es `OutboxState | null`
 * y no un cuarto valor de `OutboxState`. Inventar ahí un `'unsigned'` metería en el tipo
 * de la cola algo que la cola no conoce, y `runOutbox` tendría que aprender a ignorarlo.
 *
 * La diferencia entre los tres es lo único que esta pantalla tiene que decir bien, porque
 * cada uno pide una cosa distinta:
 *
 * - **Rechazado** — no se resuelve nunca solo; hay que abrirlo y arreglarlo.
 * - **En cola** — se resuelve solo cuando vuelva la red; no hay nada que hacer.
 * - **Sin firmar** — el trabajo está a medias; lo termina el inspector, no la red.
 *
 * Los dos primeros van en ámbar («esto todavía no llegó») y el tercero en el `--draft` de
 * trabajo en curso, que es el mismo que usa `draftStatusPill` para `capturing`: es el
 * mismo borrador visto desde otra pantalla y no puede cambiar de color al cruzar la ruta.
 */
export function stateLabel(state: OutboxState | null): string {
  if (state === null) return 'Not signed yet';

  return state === 'rejected' ? 'Rejected by the server' : 'Waiting to send';
}

export function statePillClass(state: OutboxState | null): string {
  if (state === null) return 'status-pill status-pill--draft';

  return state === 'rejected'
    ? 'status-pill status-pill--overdue'
    : 'status-pill status-pill--signed';
}

/**
 * Los intentos, en palabras. `0` es un caso real y frecuente —la entrada recién firmada
 * que todavía no tuvo su primera corrida— y decir "0 attempts" ahí suena a que algo no
 * funcionó cuando lo único que pasó es que no pasó nada todavía.
 *
 * Sin fila de cola no se dice nada: un borrador sin firmar no falló cero veces, no se
 * intentó porque todavía no había qué intentar.
 */
export function attemptsLabel(attempts: number | null): string | null {
  if (attempts === null) return null;
  if (attempts === 0) return 'Not tried yet';

  return `${attempts} attempt${attempts === 1 ? '' : 's'}`;
}

/**
 * Lo rechazado primero, lo sin firmar al final.
 *
 * Las tres mitades piden cosas distintas: lo rechazado pide que el inspector lo abra y lo
 * arregle, lo encolado pide que espere, y lo sin firmar es trabajo que sigue siendo suyo.
 * Mezclados por orden de llegada, el trabajo que pide una persona se esconde entre el que
 * no pide nada — y este dispositivo puede acumular entradas de varios días (ADR-001).
 *
 * Lo sin firmar va último y no primero aunque también pida una persona: lo rechazado es
 * trabajo TERMINADO que se está por perder, y eso vence a un recorrido a medio hacer.
 *
 * Dentro de cada grupo manda el día en que se empezó, del más viejo al más nuevo: el más
 * viejo es el que lleva más tiempo sin llegar al servidor.
 */
export function byUrgency(work: readonly DeviceWork[]): DeviceWork[] {
  return [...work].sort((a, b) => {
    const rank = urgency(a) - urgency(b);

    return rank !== 0 ? rank : a.draft.created_at.localeCompare(b.draft.created_at);
  });
}

function urgency(entry: DeviceWork): number {
  if (entry.row === null) return 2;

  return entry.row.state === 'rejected' ? 0 : 1;
}

/** Cuántas de cada clase, para la tira de números del encabezado. */
export function tally(work: readonly DeviceWork[]): {
  queued: number;
  rejected: number;
  unsigned: number;
} {
  return {
    queued: work.filter((entry) => entry.row?.state === 'queued').length,
    rejected: work.filter((entry) => entry.row?.state === 'rejected').length,
    unsigned: work.filter((entry) => entry.row === null).length,
  };
}
