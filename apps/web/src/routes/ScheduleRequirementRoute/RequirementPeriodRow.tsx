import { civilToday } from '../../presentation/dates';
import { actionLabel, periodLabel, periodStatus, rowControl, rowInspector, rowNote } from './presentation';
import type { YearEntry } from '../../presentation/scheduling';

/**
 * Una fila del plan anual: qué período, en qué estado, de quién, y UN botón.
 *
 * La fila no escribe nada. Antes traía la mutación de apertura, el checkbox de
 * visibilidad, el selector de inspector y su error adentro de las celdas: con una regla
 * mensual eso son doce formularios apilados y el plan deja de poder leerse de un vistazo.
 * Ahora avisa QUÉ se quiso hacer y la ruta abre el diálogo — que además tiene que colgar
 * de un nodo que sobreviva a la mutación, porque al abrirse un período esta fila cambia
 * de `unopened` a `opened` y con eso cambia su `key` (misma razón que
 * `SchedulingRoute/RequirementConfirmDialog`).
 */
export function RequirementPeriodRow({
  entry,
  year,
  canAdminister,
  publishedVersion,
  onAct,
}: {
  entry: YearEntry;
  year: string;
  canAdminister: boolean;
  publishedVersion: number | null;
  onAct: (kind: 'open' | 'assign') => void;
}): React.JSX.Element {
  const control = rowControl(entry, canAdminister);
  const note = rowNote(entry, civilToday());
  const label = periodLabel(entry, year);
  const action = actionLabel(entry, control);

  return (
    <tr className="annual-plan-row">
      <th scope="row" data-label="Period">
        <span className="annual-plan-row__period">{label}</span>
      </th>
      <td data-label="Status">
        <span className={`annual-plan-row__status status-pill status-pill--${statusClassName(entry)}`}>{periodStatus(entry)}</span>
        {note ? <span className={`annual-plan-row__note annual-plan-row__note--${note.tone}`}>{note.text}</span> : null}
      </td>
      <td data-label="Inspector">{rowInspector(entry)}</td>
      {/* Vacía cuando no hay nada que ofrecer, y no un «None» que en teléfono se apila
          como una fila más de la tarjeta (ver `:empty` en `index.css`). */}
      <td className="annual-plan-row__action-cell" data-label="Action">
        {action ? (
          <div className="table__actions">
            <button
              type="button"
              className="button--outline"
              aria-label={control === 'open' ? `Open ${label}` : `${action} for ${label}`}
              disabled={control === 'open' && publishedVersion === null}
              onClick={() => onAct(control === 'open' ? 'open' : 'assign')}
            >
              {action}
            </button>
          </div>
        ) : null}
      </td>
    </tr>
  );
}

function statusClassName(entry: YearEntry): string {
  if (entry.kind === 'unopened') return 'not-opened';
  if (entry.inspection.cancelled_at !== null) return 'cancelled';

  return entry.inspection.status;
}
