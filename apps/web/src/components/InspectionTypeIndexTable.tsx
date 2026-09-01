import { Link } from '@tanstack/react-router';

import type { InspectionTypeGroup } from '../presentation/inspections';

export function InspectionTypeIndexTable({
  groups,
  to,
  ariaLabel,
  countLabel,
}: {
  groups: readonly InspectionTypeGroup[];
  to: '/historical/$templateId' | '/findings/types/$templateId';
  ariaLabel: string;
  countLabel: string;
}): React.JSX.Element {
  return (
    <table className="table inspection-types__table" aria-label={ariaLabel}>
      <thead>
        <tr>
          <th scope="col">Inspection type</th>
          <th scope="col">{countLabel}</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((group) => (
          <tr key={group.templateId}>
            <th scope="row" data-label="Inspection type">
              <Link
                className="table__link inspection-types__link"
                to={to}
                params={{ templateId: group.templateId }}
              >
                {group.templateName}
              </Link>
            </th>
            <td data-label={countLabel}>{group.inspections.length}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
