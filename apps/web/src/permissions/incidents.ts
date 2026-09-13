import {
  incidentTransitionsAvailable,
  isAdministrator,
  type Incident,
  type IncidentTransition,
  type Session,
} from '@hs/contracts';

/**
 * Las transiciones que esta cuenta puede intentar, según la MISMA tabla que el servidor.
 *
 * Filtra por rol y por clasificación —`incidentTransitionsAvailable` ya saca el cierre
 * directo de las tres clasificaciones que obligan a investigar—, y **no** por las otras
 * dos condiciones: que haya causa raíz y que no queden acciones abiertas dependen del
 * estado de otras filas, y media regla copiada acá sería una que puede separarse de su
 * otra mitad. El botón se ofrece y el servidor responde `root_cause_required` o
 * `incident_has_open_actions`, que son errores que se leen.
 */
export function availableTransitions(
  incident: Incident,
  session: Session | null,
): readonly IncidentTransition[] {
  if (session === null) return [];

  return incidentTransitionsAvailable(incident.state, incident.classification).filter(
    (transition) =>
      transition.roles.includes(session.role) ||
      (transition.roles.includes('coordinator') && isAdministrator(session.role)),
  );
}

export function canReportIncident(session: Session | null): session is Session {
  return session !== null && isAdministrator(session.role);
}
