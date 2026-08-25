import { CELL_LABELS, type CellState } from '../presentation/scheduling';

/**
 * Lo que la matriz no puede decir sola.
 *
 * La casilla dibuja un icono y nada más —doce meses por fila no entran de otra forma—, así
 * que el nombre de cada estado tiene que estar en algún lado de la pantalla. Acá, arriba y
 * una sola vez, en el mismo orden en que `legendStates` los ordena.
 */
export function ScheduleLegend({ states }: { states: readonly CellState[] }): React.JSX.Element {
  return (
    <ul className="schedule-legend" aria-label="Status legend">
      {states.map((state) => (
        <li key={state} className={`schedule-legend__item schedule-legend__item--${state}`}>
          <span className="schedule-legend__dot" aria-hidden="true" />
          {CELL_LABELS[state]}
        </li>
      ))}
    </ul>
  );
}
