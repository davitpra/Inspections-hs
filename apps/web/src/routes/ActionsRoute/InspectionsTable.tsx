import { Link } from '@tanstack/react-router';

import type { InspectionActionGroup } from './presentation';

export function InspectionsTable({
  groups,
}: {
  groups: readonly InspectionActionGroup[];
}): React.JSX.Element {
  return (
    <table className="table actions-table" aria-label="Inspections with corrective actions">
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
            <th scope="row" data-label="Inspection">
              <Link to="/actions/inspection/$inspectionId" params={{ inspectionId: group.id }}>
                {group.templateName}
              </Link>
            </th>
            <td data-label="Site">{group.siteName ?? 'Multiple sites'}</td>
            <td data-label="Total">{group.total}</td>
            <td data-label="Active">{group.active}</td>
            <td data-label="Overdue">
              {group.overdue > 0 ? (
                <span className="badge badge--overdue">{group.overdue}</span>
              ) : (
                <span className="badge">0</span>
              )}
            </td>
            <td data-label="Action">
              <div className="table__actions">
                <Link
                  to="/actions/inspection/$inspectionId"
                  params={{ inspectionId: group.id }}
                  className="list__action"
                >
                  View corrective actions
                </Link>
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
