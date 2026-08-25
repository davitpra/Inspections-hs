import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { listPendingInspections, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { InfoIcon, PinIcon } from '../../components/icons';
import { listDrafts } from '../../offline/drafts';
import { civilToday } from '../../presentation/dates';
import { AssignmentChecklist } from './AssignmentChecklist';
import { AssignmentHero } from './AssignmentHero';

export function InspectionAssignmentRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/inspections/$id' });
  const { account } = useAppSession();
  const pending = useQuery({
    queryKey: queryKeys.pendingInspections(),
    queryFn: listPendingInspections,
    retry: false,
  });
  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
    retry: false,
  });
  const drafts = useQuery({
    queryKey: queryKeys.drafts(account?.userId),
    queryFn: async () => (account ? listDrafts(account.userId) : []),
    enabled: Boolean(account),
  });
  const inspection = pending.data?.find((item) => item.id === id);
  const draft = drafts.data?.find((item) => item.scheduled_inspection_id === id) ?? null;
  const site = inspection
    ? sites.data?.find((item) => item.id === inspection.site_id)
    : undefined;
  const loading = pending.isPending || sites.isPending || drafts.isPending;

  return (
    <>
      <Link to="/" className="back-link">Back to my inspections</Link>

      {loading ? <p className="status-card">Loading inspection…</p> : null}
      {pending.isError || sites.isError ? (
        <p className="notice notice--warn" role="alert">
          This inspection needs a connection before it can be opened.
        </p>
      ) : null}
      {drafts.isError ? (
        <p className="notice notice--warn" role="alert">
          Drafts on this device could not be read.
        </p>
      ) : null}
      {pending.isSuccess && sites.isSuccess && drafts.isSuccess && !inspection ? (
        <p className="notice" role="alert">
          This inspection is not available in your pending assignments.
        </p>
      ) : null}

      {account && inspection && sites.isSuccess && drafts.isSuccess ? (
        <>
          <AssignmentHero
            inspection={inspection}
            site={site}
            account={account}
            draftStatus={draft?.status ?? null}
            draftTemplateVersionId={draft?.template_version_id ?? null}
            today={civilToday()}
          />

          <div className="assignment__layout">
            <div>
              <AssignmentChecklist inspection={inspection} draft={draft} />
            </div>

            <aside className="assignment__aside">
              <div className="card">
                <h3><InfoIcon size={18} /> Before you begin</h3>
                <ul className="checklist">
                  <li>Review the inspection instructions.</li>
                  <li>Be on site and walk all areas.</li>
                  <li>Take photos of any issues.</li>
                  <li>Save your progress as you go.</li>
                  <li>Submit by the due date.</li>
                </ul>
              </div>

              <div className="card">
                <h3><PinIcon size={18} /> Site information</h3>
                <p className="progress__text">{site?.name ?? '—'}</p>
              </div>
            </aside>
          </div>
        </>
      ) : null}
    </>
  );
}
