import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { listIncidents } from '../api/incidents';
import {
  CLASSIFICATION_LABELS,
  INCIDENT_STATE_LABELS,
  formatDay,
} from './incident-presentation';

/**
 * Los incidentes que esta cuenta puede ver.
 *
 * **La lista no filtra nada, y esa ausencia es el invariante.** Un supervisor ve los que
 * cargó él porque la política RLS de 0012 no le devuelve los demás, no porque este
 * componente los descarte. El coordinador y gerencia ven todos los de su alcance por la
 * misma razón.
 *
 * No hay contador de "los que no ves": decir cuántos hay ya sería decir que hay.
 */
export function IncidentsRoute(): React.JSX.Element {
  const incidents = useQuery({
    queryKey: ['incidents'],
    queryFn: listIncidents,
    retry: false,
  });

  if (incidents.isError) return <p className="notice">This list needs a connection.</p>;
  if (!incidents.data) return <p>Loading…</p>;

  return (
    <>
      <h1>Incidents</h1>

      <p>
        <Link to="/incidents/report">Report an incident</Link>
      </p>

      {incidents.data.length === 0 ? (
        <p>No incidents to show.</p>
      ) : (
        <ul className="list">
          {incidents.data.map((incident) => {
            const overdue = incident.clocks.some((clock) => clock.overdue);

            return (
              <li key={incident.id} className="list__row">
                <Link to="/incidents/$id" params={{ id: incident.id }}>
                  {CLASSIFICATION_LABELS[incident.classification]}
                </Link>
                <span>
                  {INCIDENT_STATE_LABELS[incident.state]} — {formatDay(incident.occurred_at)}
                </span>
                {overdue ? <span className="badge badge--overdue">Deadline passed</span> : null}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
