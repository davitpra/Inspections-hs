import { Link } from '@tanstack/react-router';

import { ExternalLinkIcon } from '../../components/icons';
import type { InspectionActionGroup } from './presentation';

export function InspectionsTable({
  groups,
}: {
  groups: readonly InspectionActionGroup[];
}): React.JSX.Element {
  return (
    <div className="actions-overview__table-wrap">
      <table className="table actions-table actions-overview__table" aria-label="Inspections with corrective actions">
        <thead>
          <tr>
            <th scope="col">Inspection</th>
            <th scope="col">Site</th>
            <th scope="col">Total</th>
            <th scope="col">Active</th>
            <th scope="col">Overdue</th>
            <th scope="col">Action</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <tr key={group.id}>
              <th scope="row" data-label="Inspection" className="actions-overview__primary-cell">
                <Link
                  to="/actions/inspection/$inspectionId"
                  params={{ inspectionId: group.id }}
                >
                  {group.templateName}
                </Link>
              </th>
              <td data-label="Site">{group.siteName ?? 'Multiple sites'}</td>
              <td data-label="Total"><span className="actions-overview__number">{group.total}</span></td>
              <td data-label="Active"><span className="actions-overview__number">{group.active}</span></td>
              <td data-label="Overdue">
                {group.overdue > 0 ? (
                  <span className="badge badge--overdue">{group.overdue}</span>
                ) : (
                  <span className="badge">0</span>
                )}
              </td>
              <td data-label="Action" className="actions-overview__action-cell">
                <div className="table__actions">
                  <Link
                    to="/actions/inspection/$inspectionId"
                    params={{ inspectionId: group.id }}
                    className="list__action actions-overview__view-link"
                  >
                    View corrective actions <ExternalLinkIcon size={16} />
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
