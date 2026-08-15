import { ASSIGNEE, type Action, type ActionTransition, type Session } from '@hs/contracts';

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
