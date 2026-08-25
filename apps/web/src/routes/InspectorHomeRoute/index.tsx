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
import { DeviceDrafts } from './DeviceDrafts';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { InspectorSchedule } from './InspectorSchedule';
import { RecentInspections } from './RecentInspections';
import { ScheduledInspections } from './ScheduledInspections';
import { draftPeriodStart, pendingWork } from './presentation';

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

      <ScheduledInspections
        inspections={pending.data}
        drafts={drafts.data ?? []}
        siteName={siteName}
        loading={loading}
        remoteError={pending.isError || sites.isError}
        draftsError={drafts.isError}
        ready={pending.isSuccess && sites.isSuccess && drafts.isSuccess}
      />

      {account ? (
        <InspectorSchedule
          scheduled={scheduled.data ?? []}
          accountId={account.userId}
          status={scheduled.status}
        />
      ) : null}

      {account ? (
        <RecentInspections
          scheduled={scheduled.data ?? []}
          userId={account.userId}
          siteName={siteName}
        />
      ) : null}

      <DeviceDrafts
        drafts={working}
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
