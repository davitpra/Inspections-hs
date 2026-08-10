import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Action, ActionState } from '@hs/contracts';

import { listActions } from '../api/actions';
import { STATE_LABELS, formatDate } from './action-permissions';

/**
 * Las acciones correctivas de las plantas del alcance (§3 R3).
 *
 * Online y sin Dexie (design D15): una acción se ejecuta con red. Si la lista no carga,
 * se dice que hace falta conexión y no se inventa una copia local que podría estar
 * mostrando un estado que ya cambió.
 *
 * Ordenadas por vencimiento, que es el orden en que importan. **Lo vencido se nombra**:
 * un badge rojo dice que algo pasa, "4 days overdue" dice qué.
 */
export function ActionsRoute(): React.JSX.Element {
  const actions = useQuery({
    queryKey: ['actions'],
    queryFn: listActions,
    retry: false,
  });

  const rows = actions.data ?? [];

  return (
    <>
      <h1>Corrective actions</h1>

      {actions.isError ? (
        <p className="notice">Corrective actions need a connection.</p>
      ) : null}

      {actions.isSuccess && rows.length === 0 ? (
        <p>No corrective actions are open for your sites.</p>
      ) : null}

      <ul className="list">
        {rows.map((action) => (
          <li key={action.id} className="list__row">
            <Link to="/actions/$id" params={{ id: action.id }}>
              {action.description}
            </Link>

            <StateBadge state={action.state} />

            {action.overdue && action.state !== 'closed' ? (
              <span className="badge badge--overdue">Due {formatDate(action.due_at)}</span>
            ) : (
              <span className="badge">Due {formatDate(action.due_at)}</span>
            )}

            {action.escalations.map((escalation) => (
              <span key={escalation.level} className="badge badge--overdue">
                Escalated to {escalation.level === 'management' ? 'management' : 'the supervisor'}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * El estado, en palabras y no en un color.
 *
 * Sale del stream de eventos del servidor —no hay columna de estado que leer— y se
 * muestra tal cual: la UI no deriva ni reinterpreta nada.
 */
export function StateBadge({ state }: { state: ActionState }): React.JSX.Element {
  return <span className={`badge badge--${state}`}>{STATE_LABELS[state]}</span>;
}

export type { Action };
