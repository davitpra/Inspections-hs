import type { InspectionSchedule, ScheduledInspection } from "@hs/contracts";
import { YearNavigator } from "../../components/YearNavigator";
import {
  earliestEligibleYear,
  legendStates,
  matrixRows,
  type YearEntry,
} from "./presentation";
import { ScheduleLegend } from "./ScheduleLegend";
import { ScheduleMatrix } from "./ScheduleMatrix";

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
        {/* El título con su descripción a la izquierda y el año a la derecha, arriba del
            todo: el año es lo que cambia y tiene que quedar al alcance del pulgar. La
            descripción envuelve dentro de SU columna —no cruza por debajo del navegador—,
            y la leyenda cierra la cabecera a lo ancho. */}
        <div className="schedule-section__bar">
          <div className="schedule-section__title">
            <h2 id="schedule-heading">Annual schedule</h2>
            <p className="note">
              Compliance matrix, month by month, for every active requirement of
              this site.
            </p>
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
          <strong>No obligations in this year.</strong>
          <span>No requirements owe a period for this site and year.</span>
        </div>
      ) : (
        <ScheduleMatrix entries={entries} year={year} onSelect={onSelect} />
      )}
    </section>
  );
}
