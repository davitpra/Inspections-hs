import type { ActionState } from '@hs/contracts';

/**
 * Cómo se nombra cada cosa en las pantallas de acciones correctivas.
 *
 * Aparte del componente para que se pueda probar sin renderizar: que el botón diga
 * "Send it back" y no "In progress" es una decisión, y las decisiones se comprueban.
 */

/** El estado en palabras. Sale del stream del servidor; la UI no lo deriva. */
export const STATE_LABELS: Readonly<Record<ActionState, string>> = {
  open: 'Open',
  in_progress: 'In progress',
  awaiting_verification: 'Awaiting verification',
  closed: 'Closed',
};

/**
 * El texto del botón por transición.
 *
 * Por PAR y no por destino: `awaiting_verification → in_progress` y `open → in_progress`
 * llegan al mismo estado y son cosas distintas —"devolver el trabajo" y "empezar"—, y un
 * botón que dijera "In progress" en los dos casos no diría nada en ninguno.
 */
export const TRANSITION_LABELS: Readonly<Record<string, string>> = {
  'open->in_progress': 'Start work',
  'in_progress->awaiting_verification': 'Declare the work done',
  'awaiting_verification->closed': 'Verify and close',
  'awaiting_verification->in_progress': 'Send it back',
};

export function transitionLabel(from: ActionState, to: ActionState): string {
  return TRANSITION_LABELS[`${from}->${to}`] ?? STATE_LABELS[to];
}
