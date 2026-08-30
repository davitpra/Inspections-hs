import { ASSIGNEE, type Action, type ActionTransition, type Finding, type Session } from '@hs/contracts';

/**
 * Quién puede abrir una acción sobre ESTE hallazgo (ADR-017).
 *
 * No es solo el coordinador: también la cuenta que reportó el hallazgo —`reported_by`—,
 * que en uno derivado es quien firmó el envío y en uno manual quien lo cargó. Es la misma
 * clase de regla que `canAttempt` aplica sobre una transición: una RELACIÓN con este
 * registro puntual, resuelta contra `session.userId` porque `reported_by` es una CUENTA
 * y no una persona del roster. Un `jhsc_member` que no reportó este hallazgo sigue sin
 * poder abrir nada.
 *
 * La interfaz ofrece el control; el servidor vuelve a autorizarlo en `ActionsService.create`.
 */
export function canCreateAction(
  account: Session | null,
  finding: Pick<Finding, 'reported_by'>,
): boolean {
  if (account === null) return false;

  return account.role === 'hs_coordinator' || account.userId === finding.reported_by;
}

/**
 * Quién puede enmendar la asignación de una acción de ESTE hallazgo antes de empezar el
 * trabajo (ADR-018).
 *
 * Se autoriza igual que abrir la acción (ADR-017): coordinador, más la cuenta que
 * reportó el hallazgo. Corregir un error de responsable, trabajo o fecha es de la misma
 * clase de decisión que la asignación original, no una nueva. La interfaz ofrece el
 * control; el servidor vuelve a autorizarlo en `ActionsService.amendCommitment`.
 */
export function canAmendAssignment(
  account: Session | null,
  finding: Pick<Finding, 'reported_by'>,
): boolean {
  return canCreateAction(account, finding);
}

/**
 * Si esta cuenta puede intentar esta transición, según la MISMA tabla que el servidor.
 *
 * `assignee` no es un rol: es la cuenta de la persona responsable de ESTA acción, y por
 * eso se resuelve contra `session.personId` y no contra `session.role`.
 * Solo pide esa relación: el listado trae `ActionSummary`, sin el stream de `events`, y
 * alcanza para tomar esta decisión.
 *
 * Lo que esto **no** decide es la regla del verificador —quien ejecutó no cierra, salvo el
 * coordinador de H&S (ADR-019)—, porque necesita saber quién declaró el trabajo hecho y eso
 * depende del stream, no del rol. El botón se ofrece y el servidor responde
 * `verifier_is_executor` a quien todavía la tiene prohibida, que es un error que se lee.
 * Media regla copiada acá sería una que puede separarse de la otra mitad.
 */
export function canAttempt(
  transition: ActionTransition,
  action: Pick<Action, 'assignee_person_id'>,
  session: Session | null,
): boolean {
  if (session === null) return false;

  if (transition.roles.includes(session.role)) return true;

  return transition.roles.includes(ASSIGNEE) && session.personId === action.assignee_person_id;
}
