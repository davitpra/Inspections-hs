import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { CalendarIcon } from '../../components/icons';
import { completedInspections } from '../../presentation/inspections';
import { inspectionHistoryForType } from '../HistoricalInspectionsRoute/presentation';

/** Todo lo que esta cuenta cerró bajo una identidad estable de plantilla. */
export function HistoricalInspectionTypeRoute(): React.JSX.Element {
  const { templateId } = useParams({ from: '/historical/$templateId' });
  const { account } = useAppSession();
  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
    retry: false,
  });
  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });

  if (scheduled.isLoading || sites.isLoading) {
    return <p className="status-card">Loading inspection history…</p>;
  }

  if (scheduled.isError || sites.isError) {
    return (
      <p className="status-card status-card--error">
        Inspection history needs a connection. It is kept on the server, not on this device.
      </p>
    );
  }

  const completed = account
    ? completedInspections(scheduled.data ?? [], account.userId)
    : [];
  const inspections = inspectionHistoryForType(completed, templateId);

  if (inspections.length === 0) {
    return (
      <div className="status-card">
        <h1>Inspection type not found</h1>
        <p>This inspection type is not visible to your account.</p>
        <Link className="back-link" to="/historical">
          Back to historical inspections
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
              <CalendarIcon size={22} />
            </span>
            <h1>{templateName}</h1>
          </div>
          <p className="scheduling__subtitle">
            Every inspection of this type you have completed, most recent first.
          </p>
        </div>
      </header>

      <p>
        <Link className="back-link" to="/historical">
          Back to historical inspections
        </Link>
      </p>

      <CompletedInspectionsTable
        inspections={inspections}
        siteName={siteName}
        to="/inspections/$id/report"
        actionLabel="View report"
      />
    </>
  );
}
