import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { listScheduled, listSchedules, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CalendarIcon, InfoIcon } from '../../components/icons';
import { PeriodDialog } from '../../components/PeriodDialog';
import { ScheduleSection } from '../../components/ScheduleSection';
import { SitePicker } from '../../components/SitePicker';
import { canAdministerScheduling } from '../../permissions/session';
import { currentCivilYear } from '../../presentation/dates';
import {
  isUnassigned,
  projectYear,
  unassignedNotice,
  type YearEntry,
} from '../../presentation/scheduling';
import { resolveSiteId } from '../../presentation/sites';
import { RequirementsSection } from './RequirementsSection';

export function SchedulingRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const schedules = useQuery({ queryKey: queryKeys.inspectionSchedules(), queryFn: listSchedules, retry: false });
  const scheduled = useQuery({ queryKey: queryKeys.scheduledInspections(), queryFn: listScheduled, retry: false });
  const [chosenSite, setChosenSite] = useState<string | null>(null);
  const [year, setYear] = useState(() => currentCivilYear());
  const [selectedEntry, setSelectedEntry] = useState<YearEntry | null>(null);

  const siteId = resolveSiteId(sites.data ?? [], account?.siteScope ?? [], chosenSite);
  const canAdminister = canAdministerScheduling(account);
  const siteName = (id: string): string => sites.data?.find((site) => site.id === id)?.name ?? '';
  const noActiveSite = sites.isSuccess && siteId === '';
  const ready = sites.isSuccess && schedules.isSuccess && scheduled.isSuccess && siteId !== '';
  const rules = (schedules.data ?? []).filter((rule) => rule.site_id === siteId);
  const periods = (scheduled.data ?? []).filter((entry) => entry.site_id === siteId);
  const entries = ready ? projectYear(rules, periods, year) : [];
  const yearUnassigned = entries.filter((entry): entry is Extract<YearEntry, { kind: 'opened' }> => entry.kind === 'opened' && isUnassigned(entry.inspection));
  const notice = unassignedNotice(yearUnassigned.map((entry) => entry.inspection));

  const setYearAndResetSelection = (nextYear: string) => {
    setYear(nextYear);
    setSelectedEntry(null);
  };

  return (
    <>
      <header className="scheduling__top roster-header">
        <div className="scheduling__header">
          <div className="scheduling__title"><span className="scheduling__icon"><CalendarIcon size={22} /></span><h1>Scheduling</h1></div>
          <p className="scheduling__subtitle">Plan and assign each inspection period this site owes throughout the year.</p>
        </div>
        {sites.isSuccess && !noActiveSite ? (
          <div className="scheduling__header-actions roster-header__actions">
            <SitePicker sites={sites.data ?? []} value={siteId} onChange={setChosenSite} siteName={siteName} />
          </div>
        ) : null}
      </header>

      {sites.isLoading || schedules.isLoading || scheduled.isLoading ? <p className="status-card"><CalendarIcon size={20} /> Loading scheduling data…</p> : null}
      {sites.isError || schedules.isError || scheduled.isError ? <p className="status-card status-card--error"><InfoIcon size={20} /> This view needs a connection. Scheduling data could not be loaded.</p> : null}
      {noActiveSite ? <p className="status-card"><InfoIcon size={20} /> No active sites.</p> : null}

      {ready && notice ? (
        <div className="notice-card">
          <div className="notice-card__body"><span className="notice-card__icon"><InfoIcon size={22} /></span><p className="notice-card__text">{notice} This notice is limited to {year}.</p></div>
        </div>
      ) : null}

      {ready ? <>
        <RequirementsSection rules={rules} siteId={siteId} canAdminister={canAdminister} ready={schedules.isSuccess} />
        <ScheduleSection
          rules={rules}
          periods={periods}
          entries={entries}
          year={year}
          onYearChange={setYearAndResetSelection}
          onSelect={setSelectedEntry}
        />
      </> : null}

      {selectedEntry && ready ? <PeriodDialog key={entryKey(selectedEntry)} entry={selectedEntry} year={year} onClose={() => setSelectedEntry(null)} /> : null}
    </>
  );
}

function entryKey(entry: YearEntry): string {
  return entry.kind === 'opened' ? entry.inspection.id : `${entry.period.template_id}|${entry.period.period_start}`;
}
