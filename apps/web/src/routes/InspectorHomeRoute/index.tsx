import { useQuery } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useState } from 'react';

import { listPendingInspections, listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { InstallPrompt } from '../../app/InstallPrompt';
import { useAppSession } from '../../app/session-context';
import { CalendarIcon } from '../../components/icons';
import type { DraftRow as DraftRowData } from '../../offline/db';
import { listDrafts } from '../../offline/drafts';
import { civilToday } from '../../presentation/dates';
import { DeviceDrafts } from './DeviceDrafts';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { RecentInspections } from './RecentInspections';
import { ScheduledInspectionRow } from './ScheduledInspectionRow';
import { draftPeriodStart, pendingWork, scheduledInspectionRows } from './presentation';

/** La entrada del inspector: primero todo lo que debe; después, historia y trabajo local. */
export function InspectorHomeRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const { submitted } = useSearch({ from: '/' });
  const [discarding, setDiscarding] = useState<DraftRowData | null>(null);
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
  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });
  const rows = scheduledInspectionRows(pending.data ?? [], civilToday());
  const loading = pending.isPending || sites.isPending || drafts.isPending;
  const siteName = (siteId: string): string =>
    sites.data?.find((site) => site.id === siteId)?.name ?? siteId;
  const working = pendingWork(drafts.data ?? []);

  return (
    <>
      <InstallPrompt />

      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon"><CalendarIcon size={22} /></span>
            <h1>My inspections</h1>
          </div>
          <p className="scheduling__subtitle">
            Choose an assigned inspection to prepare and complete.
          </p>
        </div>
        <Link to="/inspections/past" className="list__action">
          View past inspections
        </Link>
      </header>

      {submitted === 'accepted' ? (
        <p className="notice">
          Your signed inspection was sent and accepted. It is no longer waiting on this
          device.
        </p>
      ) : null}

      <section className="requirements-section scheduled-inspections" aria-labelledby="scheduled-heading">
        <div className="requirements-section__head">
          <div>
            <h2 id="scheduled-heading">
              Scheduled inspections{' '}
              {pending.data ? <span className="note">({rows.length})</span> : null}
            </h2>
            <p className="note">Every inspection assigned to you that still needs to be sent.</p>
          </div>
        </div>

        {loading ? <p className="schedule-empty">Loading scheduled inspections…</p> : null}
        {pending.isError || sites.isError ? (
          <p className="notice notice--warn" role="alert">
            Scheduled inspections need a connection. Try again when you are online.
          </p>
        ) : null}
        {drafts.isError ? (
          <p className="notice notice--warn" role="alert">
            Drafts on this device could not be read.
          </p>
        ) : null}
        {pending.isSuccess && sites.isSuccess && drafts.isSuccess && rows.length === 0 ? (
          <p className="schedule-empty">Nothing is scheduled for you.</p>
        ) : null}

        {pending.isSuccess && sites.isSuccess && drafts.isSuccess && rows.length > 0 ? (
          <table className="table scheduled-inspections__table" aria-label="Scheduled inspections">
            <thead>
              <tr>
                <th scope="col">Period</th>
                <th scope="col">Requirement</th>
                <th scope="col">Site</th>
                <th scope="col">Due</th>
                <th scope="col">Status</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ScheduledInspectionRow
                  key={row.inspection.id}
                  row={row}
                  siteName={siteName(row.inspection.site_id)}
                  drafts={drafts.data}
                />
              ))}
            </tbody>
          </table>
        ) : null}
      </section>

      {account ? (
        <RecentInspections
          scheduled={scheduled.data ?? []}
          userId={account.userId}
          siteName={siteName}
        />
      ) : null}

      <DeviceDrafts
        title="Drafts on this device"
        drafts={working}
        empty="No drafts in progress on this device."
        periodStart={(draft) => draftPeriodStart(draft, pending.data ?? [])}
        siteName={siteName}
        onDiscard={setDiscarding}
      />

      {discarding && account ? (
        <DiscardDraftDialog
          clientSubmissionId={discarding.client_submission_id}
          accountId={account.userId}
          startedOn={discarding.created_at.slice(0, 10)}
          onClose={() => setDiscarding(null)}
        />
      ) : null}
    </>
  );
}
