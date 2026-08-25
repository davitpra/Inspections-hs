import { CalendarIcon } from './icons';

/** Navegación anual compartida por el calendario completo y el plan de un requisito. */
export function YearNavigator({
  year,
  earliestYear,
  onYearChange,
}: {
  year: string;
  earliestYear: string;
  onYearChange: (year: string) => void;
}): React.JSX.Element {
  const canGoBack = year > earliestYear;

  return (
    <div className="year-nav" aria-label="Calendar year">
      <button
        type="button"
        className="year-nav__arrow"
        disabled={!canGoBack}
        onClick={() => onYearChange(String(Number(year) - 1))}
      >
        ← {Number(year) - 1}
      </button>
      <div className="year-nav__current">
        <CalendarIcon size={18} />
        <h3>{year}</h3>
      </div>
      <button
        type="button"
        className="year-nav__arrow"
        onClick={() => onYearChange(String(Number(year) + 1))}
      >
        {Number(year) + 1} →
      </button>
    </div>
  );
}
