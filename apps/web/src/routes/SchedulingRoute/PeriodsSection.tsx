import type { ScheduledInspection } from '@hs/contracts';

import { PeriodRow } from './PeriodRow';

/** Los períodos abiertos por esas reglas, con su estado y su dueño. */
export function PeriodsSection({
  periods,
  siteId,
  canAdminister,
}: {
  periods: readonly ScheduledInspection[];
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  return (
    <section>
      <h2>Scheduled inspections</h2>

      <ul className="list">
        {periods.map((inspection) => (
          <PeriodRow
            key={inspection.id}
            inspection={inspection}
            siteId={siteId}
            canAdminister={canAdminister}
          />
        ))}
      </ul>
    </section>
  );
}
