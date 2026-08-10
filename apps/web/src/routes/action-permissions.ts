import { ASSIGNEE, type Action, type ActionState, type ActionTransition } from '@hs/contracts';
import type { Session } from '@hs/contracts';

/**
 * Qué ofrece la pantalla de una acción correctiva, y cómo se llama cada cosa.
 *
 * Aparte del componente para que se pueda probar sin renderizar: lo que importa acá es
 * la decisión —qué botones aparecen para quién— y no el marcado que la muestra.
 */

/**
 * Si esta cuenta puede intentar esta transición, según la MISMA tabla que el servidor.
 *
 * `assignee` no es un rol: es la cuenta de la persona responsable de ESTA acción, y por
 * eso se resuelve contra `session.personId` y no contra `session.role`.
 *
 * Lo que esto **no** decide es la regla del verificador —quien ejecutó no cierra—,
 * porque necesita saber quién declaró el trabajo hecho y eso depende del stream, no del
 * rol. El botón se ofrece y el servidor responde `verifier_is_executor`, que es un error
 * que se lee. Media regla copiada acá sería una que puede separarse de la otra mitad.
 */
export function canAttempt(
  transition: ActionTransition,
  action: Action,
  session: Session | null,
): boolean {
  if (session === null) return false;

  if (transition.roles.includes(session.role)) return true;

  return transition.roles.includes(ASSIGNEE) && session.personId === action.assignee_person_id;
}

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

/** La fecha, sin hora: un plazo se lee por día. */
export function formatDate(value: string): string {
  return value.slice(0, 10);
}
