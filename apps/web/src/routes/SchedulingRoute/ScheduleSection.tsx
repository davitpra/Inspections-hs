import type { InspectionSchedule, ScheduledInspection } from '@hs/contracts';

import { YearNavigator } from '../../components/YearNavigator';
import { earliestEligibleYear, legendStates, matrixRows, type YearEntry } from './presentation';
import { ScheduleLegend } from './ScheduleLegend';
import { ScheduleMatrix } from './ScheduleMatrix';

export function ScheduleSection({
  rules,
  periods,
  entries,
  year,
  onYearChange,
  onSelect,
}: {
  rules: readonly InspectionSchedule[];
  periods: readonly ScheduledInspection[];
  entries: readonly YearEntry[];
  year: string;
  onYearChange: (year: string) => void;
  onSelect: (entry: YearEntry) => void;
}): React.JSX.Element {
  const earliestYear = earliestEligibleYear(rules, periods, year);
  const rows = matrixRows(entries);

  return (
    <section className="schedule-section" aria-labelledby="schedule-heading">
      <div className="schedule-section__head">
        <div className="schedule-section__title">
          <h2 id="schedule-heading">Annual schedule</h2>
          <p className="note">Compliance matrix, month by month, for every active requirement of this site.</p>
        </div>
        <ScheduleLegend states={legendStates(rows)} />
        <YearNavigator year={year} earliestYear={earliestYear} onYearChange={onYearChange} />
      </div>
      {entries.length === 0 ? (
        <div className="schedule-empty"><strong>No obligations in this year.</strong><span>No requirements owe a period for this site and year.</span></div>
      ) : (
        <ScheduleMatrix entries={entries} year={year} onSelect={onSelect} />
      )}
      <p className="schedule-section__foot">Opening a period freezes the published template version for that inspection.</p>
    </section>
  );
}
