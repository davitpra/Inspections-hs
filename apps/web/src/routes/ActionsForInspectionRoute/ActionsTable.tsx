import type { ActionSummary } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { StateBadge } from '../../components/StateBadge';
import { formatDay } from '../../presentation/dates';
import { sourceLabel } from './presentation';

export function ActionsTable({
  actions,
}: {
  actions: readonly ActionSummary[];
}): React.JSX.Element {
  return (
    <table className="table actions-table" aria-label="Corrective actions">
      <thead>
        <tr>
          <th scope="col">Corrective action</th>
          <th scope="col">Source</th>
          <th scope="col">Site</th>
          <th scope="col">Assigned to</th>
          <th scope="col">Due</th>
          <th scope="col">Status</th>
          <th scope="col">Action</th>
        </tr>
      </thead>
      <tbody>
        {actions.map((action) => (
          <tr key={action.id}>
            <th scope="row" data-label="Corrective action">
              <Link to="/actions/$id" params={{ id: action.id }}>
                {action.description}
              </Link>
            </th>
            <td data-label="Source">{sourceLabel(action)}</td>
            <td data-label="Site">{action.site_name}</td>
            <td data-label="Assigned to">{action.assignee_name ?? 'Assigned person unavailable'}</td>
            <td data-label="Due">
              <span className={action.overdue && action.state !== 'closed' ? 'badge badge--overdue' : 'badge'}>
                Due {formatDay(action.due_at)}
              </span>
            </td>
            <td data-label="Status">
              <div className="actions-table__status">
                <StateBadge state={action.state} />
                {action.escalations.map((escalation) => (
                  <span key={escalation.level} className="badge badge--overdue">
                    Escalated to {escalation.level === 'management' ? 'management' : 'supervisor'}
                  </span>
                ))}
              </div>
            </td>
            <td data-label="Action">
              <div className="table__actions">
                <Link to="/actions/$id" params={{ id: action.id }} className="list__action">
                  View action
                </Link>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
