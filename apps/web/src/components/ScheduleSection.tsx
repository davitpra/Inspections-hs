import type { InspectionSchedule, ScheduledInspection } from '@hs/contracts';

import {
  earliestEligibleYear,
  legendStates,
  matrixRows,
  type YearEntry,
} from '../presentation/scheduling';
import { ScheduleLegend } from './ScheduleLegend';
import { ScheduleMatrix } from './ScheduleMatrix';
import { YearNavigator } from './YearNavigator';

export interface ScheduleSectionCopy {
  heading: string;
  description: string;
  emptyHeading: string;
  emptyDescription: string;
}

const DEFAULT_COPY: ScheduleSectionCopy = {
  heading: 'Annual schedule',
  description: 'Compliance matrix, month by month, for every active requirement of this site.',
  emptyHeading: 'No obligations in this year.',
  emptyDescription: 'No requirements owe a period for this site and year.',
};

export function ScheduleSection({
  rules = [],
  periods,
  entries,
  year,
  onYearChange,
  onSelect,
  copy = DEFAULT_COPY,
}: {
  rules?: readonly InspectionSchedule[];
  periods: readonly ScheduledInspection[];
  entries: readonly YearEntry[];
  year: string;
  onYearChange: (year: string) => void;
  onSelect: (entry: YearEntry) => void;
  copy?: ScheduleSectionCopy;
}): React.JSX.Element {
  const earliestYear = earliestEligibleYear(rules, periods, year);
  const rows = matrixRows(entries);

  return (
    <section className="schedule-section" aria-labelledby="schedule-heading">
      <div className="schedule-section__head">
        <div className="schedule-section__bar">
          <div className="schedule-section__title">
            <h2 id="schedule-heading">{copy.heading}</h2>
            <p className="note">{copy.description}</p>
          </div>
          <YearNavigator
            year={year}
            earliestYear={earliestYear}
            onYearChange={onYearChange}
          />
        </div>
        <ScheduleLegend states={legendStates(rows)} />
      </div>
      {entries.length === 0 ? (
        <div className="schedule-empty">
          <strong>{copy.emptyHeading}</strong>
          <span>{copy.emptyDescription}</span>
        </div>
      ) : (
        <ScheduleMatrix entries={entries} year={year} onSelect={onSelect} />
      )}
    </section>
  );
}
