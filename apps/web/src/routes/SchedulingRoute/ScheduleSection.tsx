import type { InspectionSchedule } from '@hs/contracts';

import { earliestEligibleYear, type ScheduleFilters, type YearEntry, type YearStats } from './presentation';
import { ScheduleList } from './ScheduleList';
import { ScheduleMatrix } from './ScheduleMatrix';
import { ScheduleToolbar } from './ScheduleToolbar';

export function ScheduleSection({
  rules,
  periods,
  entries,
  visibleEntries,
  year,
  onYearChange,
  filters,
  onFiltersChange,
  stats,
  view,
  onViewChange,
  onSelect,
}: {
  rules: readonly InspectionSchedule[];
  periods: readonly import('@hs/contracts').ScheduledInspection[];
  entries: readonly YearEntry[];
  visibleEntries: readonly YearEntry[];
  year: string;
  onYearChange: (year: string) => void;
  filters: ScheduleFilters;
  onFiltersChange: (filters: ScheduleFilters) => void;
  stats: YearStats;
  view: 'matrix' | 'list';
  onViewChange: (view: 'matrix' | 'list') => void;
  onSelect: (entry: YearEntry) => void;
}): React.JSX.Element {
  const earliestYear = earliestEligibleYear(rules, periods, year);
  const canGoBack = year > earliestYear;

  return (
    <section className="schedule-section" aria-labelledby="schedule-heading">
      <div className="schedule-section__head">
        <div>
          <h2 id="schedule-heading">Annual schedule</h2>
          <p className="note">Every period owed by this site for the selected year.</p>
        </div>
      </div>
      <ScheduleToolbar
        year={year}
        canGoBack={canGoBack}
        onYearChange={onYearChange}
        rules={rules}
        filters={filters}
        onFiltersChange={onFiltersChange}
        stats={stats}
        view={view}
        onViewChange={onViewChange}
      />
      {entries.length === 0 ? (
        <div className="schedule-empty"><strong>No obligations in this year.</strong><span>No requirements owe a period for this site and year.</span></div>
      ) : visibleEntries.length === 0 ? (
        <div className="schedule-empty"><strong>No periods match these filters.</strong><span>Clear filters to see the full annual schedule.</span></div>
      ) : view === 'matrix' ? (
        <ScheduleMatrix entries={visibleEntries} year={year} onSelect={onSelect} />
      ) : (
        <ScheduleList entries={visibleEntries} year={year} onSelect={onSelect} />
      )}
      <p className="schedule-section__foot">Opening a period freezes the published template version for that inspection.</p>
    </section>
  );
}
