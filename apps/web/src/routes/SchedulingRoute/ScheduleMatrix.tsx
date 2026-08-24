import type { InspectionSchedule } from '@hs/contracts';

import { calendarLabel, entryStatus, matrixRows, STATUS_LABELS, type YearEntry } from './presentation';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function ScheduleMatrix({
  entries,
  year,
  onSelect,
}: {
  entries: readonly YearEntry[];
  year: string;
  rules?: readonly InspectionSchedule[];
  onSelect: (entry: YearEntry) => void;
}): React.JSX.Element {
  const rows = matrixRows(entries);

  return (
    <div className="schedule-matrix-wrap" role="region" aria-label={`${year} schedule matrix`}>
      <table className="schedule-matrix">
        <thead>
          <tr>
            <th scope="col">Requirement</th>
            {MONTHS.map((month) => <th key={month} scope="col">{month.slice(0, 3)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.templateId}>
              <th scope="row">{row.templateName}</th>
              {row.cells.map((entry, index) => {
                if (!entry) {
                  return <td key={MONTHS[index]} className="schedule-matrix__not-due" aria-label={`${MONTHS[index]}: not due`}>Not due</td>;
                }

                const label = entry.kind === 'opened'
                  ? `${row.templateName}, ${calendarLabel(entry.inspection.period_start, entry.inspection.period_months, year)}, ${STATUS_LABELS[entry.inspection.status]}`
                  : `${row.templateName}, ${calendarLabel(entry.period.period_start, entry.period.period_months, year)}, Not opened`;
                const state = entryStatus(entry);

                return (
                  <td key={MONTHS[index]}>
                    <button
                      type="button"
                      className={`schedule-cell schedule-cell--${state}`}
                      aria-label={label}
                      onClick={() => onSelect(entry)}
                    >
                      <span className="schedule-cell__status">
                        {entry.kind === 'opened' ? STATUS_LABELS[entry.inspection.status] : 'Not opened'}
                      </span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
