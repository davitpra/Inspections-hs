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

/**
 * Qué transición admite una nota, por PAR y por el mismo motivo que las etiquetas.
 *
 * `open → in_progress` es la única que no. Empezar el trabajo no agrega al registro nada que
 * la asignación no haya dicho ya —la persona, la descripción y el plazo se escribieron al
 * crear la acción—, y el paso se anuncia como "No additional information is required": un
 * campo de texto debajo de esa frase la desmiente, y es lo primero que se ve delante del
 * único botón que importa.
 *
 * El default es admitirla: declarar el trabajo hecho, verificar y devolver son actos sobre
 * los que sí hay algo que decir, y una transición nueva no debería quedarse muda por olvido.
 *
 * El par sigue en la tabla aunque crear una acción ya la deje en `in_progress`: las que se
 * abrieron antes de ese cambio siguen en `open` y todavía se empiezan a mano.
 */
export const TRANSITION_TAKES_NOTE: Readonly<Record<string, boolean>> = {
  'open->in_progress': false,
};

export function transitionTakesNote(from: ActionState, to: ActionState): boolean {
  return TRANSITION_TAKES_NOTE[`${from}->${to}`] ?? true;
}
