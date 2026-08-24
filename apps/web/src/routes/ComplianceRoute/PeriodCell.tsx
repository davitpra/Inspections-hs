import type { CompliancePeriod } from '@hs/contracts';

import { periodLabel } from '../../presentation/dates';
import { STATUS_LABELS } from './presentation';

/**
 * Un período de la grilla.
 *
 * LOS DOS `missed` SE DISTINGUEN EN EL TEXTO Y NO CON UN QUINTO ESTADO. Para el regulador
 * «se planificó y no se hizo» y «nunca se planificó» son los dos un mes sin inspección; el
 * empleador necesita saber cuál de los dos, porque uno es un problema de ejecución y el
 * otro del planificador.
 */
export function PeriodCell({ period }: { period: CompliancePeriod }): React.JSX.Element {
  return (
    <li className={`period period--${period.status}`}>
      <span className="period__month">{periodLabel(period.period_start, period.period_months)}</span>
      <span className="period__status">{STATUS_LABELS[period.status]}</span>

      {period.status === 'missed' && period.scheduled_inspection_id === null ? (
        <span className="period__note">never scheduled</span>
      ) : null}

      {period.status === 'cancelled' && period.cancellation_reason ? (
        <span className="period__note">{period.cancellation_reason}</span>
      ) : null}
    </li>
  );
}
