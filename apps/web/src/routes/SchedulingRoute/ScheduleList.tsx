import { calendarLabel, entryStatus, entryTemplateName, listEntries, STATUS_LABELS, type YearEntry } from './presentation';

export function ScheduleList({
  entries,
  year,
  onSelect,
}: {
  entries: readonly YearEntry[];
  year: string;
  onSelect: (entry: YearEntry) => void;
}): React.JSX.Element {
  const ordered = listEntries(entries);

  return (
    <ul className="schedule-list">
      {ordered.map((entry) => {
        const name = entryTemplateName(entry);
        const label = entry.kind === 'opened'
          ? calendarLabel(entry.inspection.period_start, entry.inspection.period_months, year)
          : calendarLabel(entry.period.period_start, entry.period.period_months, year);
        const status = entry.kind === 'opened' ? STATUS_LABELS[entry.inspection.status] : 'Not opened';
        const inspector = entry.kind === 'opened'
          ? entry.inspection.inspector_name ?? (entry.inspection.inspector_id ? 'Assigned (name not visible from this site)' : 'Unassigned')
          : 'No inspector yet';

        return (
          <li key={entry.kind === 'opened' ? entry.inspection.id : `${entry.period.template_id}|${entry.period.period_start}`}>
            <button
              type="button"
              className={`schedule-list__row schedule-list__row--${entryStatus(entry)}`}
              aria-label={`${label}, ${name}, ${status}, ${inspector}`}
              onClick={() => onSelect(entry)}
            >
              <span className="schedule-list__period">{label}</span>
              <span className="schedule-list__requirement">{name}</span>
              <span className={`status-pill status-pill--${entryStatus(entry)}`}>{status}</span>
              <span className="schedule-list__inspector">{inspector}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
