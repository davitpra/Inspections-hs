import { useEffect, useRef, useState } from "react";

import type { InspectionSchedule } from "@hs/contracts";

import {
  AlertCircleIcon,
  CheckCircleIcon,
  ChevronIcon,
  ClockIcon,
  CrossCircleIcon,
  MinusCircleIcon,
} from "../../components/icons";
import {
  calendarLabel,
  CELL_LABELS,
  cellState,
  matrixRows,
  type CellState,
  type YearEntry,
} from "./presentation";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * La marca de cada estado. El mapa de NOMBRES vive en `presentation.ts` y se prueba sin
 * renderizar; este es marcado y no puede vivir ahí, pero recorre el mismo `CellState`, así
 * que agregar un estado sin su icono no compila.
 */
const MARKS: Readonly<
  Record<CellState, (props: { size?: number }) => React.JSX.Element>
> = {
  "not-due": MinusCircleIcon,
  unopened: ClockIcon,
  open: ClockIcon,
  completed: CheckCircleIcon,
  missed: AlertCircleIcon,
  cancelled: CrossCircleIcon,
};

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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  /*
   * La pista de que hay más meses a la derecha. En un teléfono la matriz siempre se
   * desplaza y la barra sola no alcanza —aparece tarde y en algunos navegadores no
   * aparece nunca—, así que el chevron lo dice mientras quede algo por ver y desaparece
   * al llegar a diciembre. Es decorativo: la región ya se anuncia y se recorre con el
   * teclado igual sin él.
   */
  useEffect(() => {
    const wrap = wrapRef.current;

    if (!wrap) return;

    const update = (): void => {
      setHasMore(wrap.scrollWidth - wrap.clientWidth - wrap.scrollLeft > 1);
    };

    update();
    wrap.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);

    return () => {
      wrap.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [entries]);

  return (
    <div className="schedule-matrix-frame">
      {hasMore ? (
        <span className="schedule-matrix__more" aria-hidden="true">
          <ChevronIcon size={18} />
        </span>
      ) : null}
      <div
        className="schedule-matrix-wrap"
        ref={wrapRef}
        role="region"
        aria-label={`${year} schedule matrix`}
      >
        <table className="schedule-matrix">
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              {MONTHS.map((month) => (
                <th key={month} scope="col">
                  {month.slice(0, 3)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.templateId}>
                <th scope="row">
                  <span className="requirement-name" title={row.templateName}>
                    {row.templateName}
                  </span>
                </th>
                {row.cells.map((entry, index) => {
                  const state = cellState(entry);
                  const Mark = MARKS[state];

                  if (!entry) {
                    return (
                      <td
                        key={MONTHS[index]}
                        className="schedule-matrix__not-due"
                      >
                        <span
                          className="schedule-cell schedule-cell--not-due"
                          aria-label={`${MONTHS[index]}: not due`}
                          role="img"
                        >
                          <Mark size={20} />
                        </span>
                      </td>
                    );
                  }

                  const period =
                    entry.kind === "opened"
                      ? calendarLabel(
                          entry.inspection.period_start,
                          entry.inspection.period_months,
                          year,
                        )
                      : calendarLabel(
                          entry.period.period_start,
                          entry.period.period_months,
                          year,
                        );

                  return (
                    <td key={MONTHS[index]}>
                      <button
                        type="button"
                        className={`schedule-cell schedule-cell--${state}`}
                        aria-label={`${row.templateName}, ${period}, ${CELL_LABELS[state]}`}
                        onClick={() => onSelect(entry)}
                      >
                        <Mark size={20} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
