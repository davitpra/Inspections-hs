import { ChevronIcon } from './icons';

/**
 * Navegación anual compartida por el calendario completo y el plan de un requisito.
 *
 * Tres años a la vista y no uno: en un teléfono el año anterior y el siguiente son los dos
 * saltos que se hacen, y verlos escritos evita tener que leer la flecha para saber a dónde
 * lleva. Las flechas quedan igual —son el objetivo grande, el que se toca con guantes— y
 * hacen exactamente lo mismo que la píldora vecina.
 */
export function YearNavigator({
  year,
  earliestYear,
  onYearChange,
}: {
  year: string;
  earliestYear: string;
  onYearChange: (year: string) => void;
}): React.JSX.Element {
  const current = Number(year);
  const canGoBack = year > earliestYear;

  return (
    <div className="year-nav" role="group" aria-label="Calendar year">
      <button
        type="button"
        className="year-nav__arrow year-nav__arrow--prev"
        aria-label={`Go to ${current - 1}`}
        disabled={!canGoBack}
        onClick={() => onYearChange(String(current - 1))}
      >
        <ChevronIcon size={20} />
      </button>
      {[current - 1, current, current + 1].map((candidate) => {
        const value = String(candidate);
        const isCurrent = candidate === current;

        return (
          <button
            key={value}
            type="button"
            className={`year-nav__year${isCurrent ? ' is-current' : ''}`}
            aria-current={isCurrent ? 'true' : undefined}
            disabled={value < earliestYear}
            onClick={() => onYearChange(value)}
          >
            {value}
          </button>
        );
      })}
      <button
        type="button"
        className="year-nav__arrow year-nav__arrow--next"
        aria-label={`Go to ${current + 1}`}
        onClick={() => onYearChange(String(current + 1))}
      >
        <ChevronIcon size={20} />
      </button>
    </div>
  );
}
