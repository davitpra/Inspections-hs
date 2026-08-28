import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "@tanstack/react-router";

import {
  listPendingInspections,
  listScheduled,
  listSites,
} from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { InstallPrompt } from "../../app/InstallPrompt";
import { useAppSession } from "../../app/session-context";
import { CalendarIcon } from "../../components/icons";
import { listDrafts } from "../../offline/drafts";
import { InspectorSchedule } from "./InspectorSchedule";
import { ScheduledInspections } from "./ScheduledInspections";

/**
 * La entrada del inspector: lo que debe, y cuándo lo debe.
 *
 * Los borradores de este dispositivo NO se listan acá: cada uno vive en la página de su
 * asignación, que es donde se retoman y donde se descartan. Lo ya cerrado tampoco: la
 * historia entera está a un link de la cabecera, y un recorte de las últimas repetía la
 * misma tabla en la pantalla que existe para lo que falta hacer.
 */
export function InspectorHomeRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const { submitted } = useSearch({ from: "/" });
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

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CalendarIcon size={22} />
            </span>
            <h1>My inspections</h1>
          </div>
          <p className="scheduling__subtitle">
            Choose an assigned inspection to prepare and complete.
          </p>
        </div>
        <Link to="/historical" className="list__action">
          View historical inspections
        </Link>
      </header>

      <InstallPrompt />
      {submitted === "accepted" ? (
        <p className="notice">
          Your signed inspection was sent and accepted. It is no longer waiting
          on this device.
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
    </>
  );
}
