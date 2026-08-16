import { CalendarIcon } from '../../components/icons';
import { OpenPeriodForm } from './OpenPeriodForm';
import { monthName } from '../../presentation/dates';
import { type UnopenedPeriod } from './presentation';

/**
 * La casilla de un mes que la regla debe y que todavía no es una fila.
 *
 * No hay `id`, ni estado, ni inspector: nada de eso existe hasta que el coordinador la
 * abre, y abrirla es lo que hace `OpenPeriodForm` (design.md — "template_version no se
 * muestra en un mes sin abrir"; el formulario nombra la versión como promesa, no como
 * estado).
 */
export function UnopenedPeriodRow({
  period,
  siteId,
  canAdminister,
}: {
  period: UnopenedPeriod;
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  return (
    <li className="period period--unopened">
      <div className="period__head">
        <span className="period__icon">
          <CalendarIcon />
        </span>

        <span className="period__title">
          <span className="period__month">{monthName(period.period_start)}</span>
          <span className="period__status">{period.template_name}</span>
        </span>

        <span className="period__badges">
          <span className="status-pill status-pill--not-opened">Not opened yet</span>
        </span>
      </div>

      {canAdminister ? (
        <OpenPeriodForm period={period} siteId={siteId} action="Open this month" />
      ) : null}
    </li>
  );
}
