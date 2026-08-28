import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";

import { listPendingInspections, listSites } from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { useAppSession } from "../../app/session-context";
import { CheckIcon, InfoIcon } from "../../components/icons";
import type { DraftRow } from "../../offline/db";
import { listDrafts } from "../../offline/drafts";
import { civilToday } from "../../presentation/dates";
import { AssignmentChecklist } from "./AssignmentChecklist";
import { AssignmentHero } from "./AssignmentHero";
import { DeviceDrafts } from "./DeviceDrafts";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import { pendingDraft } from "./presentation";

export function InspectionAssignmentRoute(): React.JSX.Element {
  const { id } = useParams({ from: "/inspections/$id" });
  const { account } = useAppSession();
  const [discarding, setDiscarding] = useState<DraftRow | null>(null);
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
  const draft =
    drafts.data?.find((item) => item.scheduled_inspection_id === id) ?? null;
  const site = inspection
    ? sites.data?.find((item) => item.id === inspection.site_id)
    : undefined;
  const loading = pending.isPending || sites.isPending || drafts.isPending;

  return (
    <div className="assignment-page">
      <nav className="assignment-page__nav" aria-label="Inspection navigation">
        <Link to="/" className="back-link">
          Back to my inspections
        </Link>
      </nav>

      <div className="assignment-page__status">
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
        {pending.isSuccess &&
        sites.isSuccess &&
        drafts.isSuccess &&
        !inspection ? (
          <p className="notice" role="alert">
            This inspection is not available in your pending assignments.
          </p>
        ) : null}
      </div>

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
            <section className="assignment__main" aria-label="Inspection progress">
              <AssignmentChecklist inspection={inspection} draft={draft} />
            </section>

            <aside className="assignment__aside">
              <div className="card assignment-guide">
                <div className="assignment-guide__head">
                  <span className="assignment-guide__icon">
                    <InfoIcon size={20} />
                  </span>
                  <div>
                    <h2>Before you begin</h2>
                    <p>Set yourself up for a complete field visit.</p>
                  </div>
                </div>
                <ul className="checklist">
                  <li><CheckIcon size={17} /> Review the inspection instructions.</li>
                  <li><CheckIcon size={17} /> Be on site and walk all areas.</li>
                  <li><CheckIcon size={17} /> Take photos of any issues.</li>
                  <li><CheckIcon size={17} /> Save your progress as you go.</li>
                  <li><CheckIcon size={17} /> Submit by the due date.</li>
                </ul>
              </div>
            </aside>
          </div>

          <DeviceDrafts
            draft={pendingDraft(draft)}
            inspection={inspection}
            siteName={site?.name ?? inspection.site_id}
            onDiscard={setDiscarding}
          />

          {discarding ? (
            <DiscardDraftDialog
              clientSubmissionId={discarding.client_submission_id}
              scheduledInspectionId={discarding.scheduled_inspection_id}
              accountId={account.userId}
              startedOn={discarding.created_at.slice(0, 10)}
              onClose={() => setDiscarding(null)}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
