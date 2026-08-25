import type { ScheduledInspection } from '@hs/contracts';
import { useState } from 'react';

import { CalendarIcon } from '../../components/icons';
import { PeriodDialog } from '../../components/PeriodDialog';
import { ScheduleSection, type ScheduleSectionCopy } from '../../components/ScheduleSection';
import { currentCivilYear } from '../../presentation/dates';
import type { YearEntry } from '../../presentation/scheduling';
import { inspectorSchedule } from './presentation';

const COPY: ScheduleSectionCopy = {
  heading: 'My annual schedule',
  description: 'Every inspection assigned to you, month by month.',
  emptyHeading: 'No assigned inspections in this year.',
  emptyDescription: 'No inspection periods in this year are assigned to your account.',
};

export function InspectorSchedule({
  scheduled,
  accountId,
  status,
}: {
  scheduled: readonly ScheduledInspection[];
  accountId: string;
  status: 'pending' | 'error' | 'success';
}): React.JSX.Element {
  const [year, setYear] = useState(() => currentCivilYear());
  const [selectedEntry, setSelectedEntry] = useState<YearEntry | null>(null);
  const calendar = inspectorSchedule(scheduled, accountId, year);
  const changeYear = (nextYear: string): void => {
    setYear(nextYear);
    setSelectedEntry(null);
  };

  if (status === 'pending') {
    return <p className="status-card"><CalendarIcon size={20} /> Loading your annual schedule…</p>;
  }

  if (status === 'error') {
    return (
      <p className="status-card status-card--error" role="alert">
        <CalendarIcon size={20} /> Your annual schedule needs a connection.
      </p>
    );
  }

  return (
    <>
      <ScheduleSection
        periods={calendar.periods}
        entries={calendar.entries}
        year={year}
        onYearChange={changeYear}
        onSelect={setSelectedEntry}
        copy={COPY}
      />

      {selectedEntry ? (
        <PeriodDialog
          key={
            selectedEntry.kind === 'opened'
              ? selectedEntry.inspection.id
              : `${selectedEntry.period.template_id}|${selectedEntry.period.period_start}`
          }
          entry={selectedEntry}
          year={year}
          onClose={() => setSelectedEntry(null)}
        />
      ) : null}
    </>
  );
}
