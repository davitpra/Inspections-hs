import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { DownloadForField } from '../../components/FieldPackage';
import type { DraftRow } from '../../offline/db';
import { missingForField } from '../../offline/prefetch';
import { assignmentState, opensCapture, readiness } from '../../presentation/inspections';
import type { ScheduledInspectionRowPresentation } from './presentation';

export function ScheduledInspectionRow({
  row,
  siteName,
  drafts,
}: {
  row: ScheduledInspectionRowPresentation;
  siteName: string;
  drafts: readonly DraftRow[];
}): React.JSX.Element {
  const { inspection } = row;
  const draft = drafts.find((item) => item.scheduled_inspection_id === inspection.id) ?? null;
  const missing = useQuery({
    queryKey: queryKeys.fieldReady(inspection.id),
    queryFn: () => missingForField(inspection.id),
  });
  const decision = assignmentState({
    readiness: readiness(missing.data),
    overdue: inspection.overdue,
    draftStatus: draft?.status ?? null,
  });

  return (
    <tr>
      <th scope="row" data-label="Period">{row.period}</th>
      <td data-label="Requirement">
        <Link
          to="/inspections/$id"
          params={{ id: inspection.id }}
          className="scheduled-inspection-row__link"
        >
          {inspection.template_name}
        </Link>
      </td>
      <td data-label="Site">{siteName}</td>
      <td data-label="Due">{row.due}</td>
      <td data-label="Status">
        {decision.pillLabel ? (
          <span className={decision.pillClass}>{decision.pillLabel}</span>
        ) : (
          <span className="note">Loading…</span>
        )}
      </td>
      <td data-label="Action" className="scheduled-inspection-row__action">
        {decision.action === 'download' ? (
          <DownloadForField id={inspection.id} advance={draft === null} />
        ) : null}
        {opensCapture(decision.action) ? (
          <Link
            to="/inspections/$id"
            params={{ id: inspection.id }}
            className="list__action"
          >
            View inspection
          </Link>
        ) : null}
        {missing.isError ? (
          <p className="notice notice--warn" role="alert">
            This device could not check the field package.
          </p>
        ) : null}
      </td>
    </tr>
  );
}
