import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { listFindings } from '../../api/findings';
import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { AlertCircleIcon } from '../../components/icons';
import { inspectionsWithFindings } from '../../presentation/findings';
import {
  completedInspections,
  inspectionHistoryForType,
} from '../../presentation/inspections';

/** Inspecciones de un tipo que esta cuenta cerró y que dejaron al menos un hallazgo. */
export function FindingInspectionTypeRoute(): React.JSX.Element {
  const { templateId } = useParams({ from: '/findings/types/$templateId' });
  const { account } = useAppSession();
  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });
  const findings = useQuery({
    queryKey: queryKeys.findings(),
    queryFn: listFindings,
    retry: false,
  });

  if (scheduled.isLoading || findings.isLoading || sites.isLoading) {
    return <p className="status-card">Loading findings…</p>;
  }

  if (scheduled.isError || findings.isError || sites.isError) {
    return (
      <p className="status-card status-card--error">
        Findings need a connection. They are kept on the server, not on this device.
      </p>
    );
  }

  const completed = account
    ? completedInspections(scheduled.data ?? [], account.userId)
    : [];
  const withFindings = inspectionsWithFindings(completed, findings.data ?? []);
  const inspections = inspectionHistoryForType(withFindings, templateId);

  if (inspections.length === 0) {
    return (
      <div className="status-card">
        <h1>Inspection type not found</h1>
        <p>This inspection type is not visible to your account.</p>
        <Link className="back-link" to="/findings">
          Back to findings
        </Link>
      </div>
    );
  }

  const templateName = inspections[0]?.template_name ?? templateId;
  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <AlertCircleIcon size={22} />
            </span>
            <h1>{templateName}</h1>
          </div>
          <p className="scheduling__subtitle">
            Inspections of this type where you recorded something to fix, most recent first.
          </p>
        </div>
      </header>

      <p>
        <Link className="back-link" to="/findings">
          Back to findings
        </Link>
      </p>

      <CompletedInspectionsTable
        inspections={inspections}
        siteName={siteName}
        to="/findings/$id"
        actionLabel="View findings"
      />
    </>
  );
}
