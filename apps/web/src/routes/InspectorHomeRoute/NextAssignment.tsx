import type { PendingInspection, Session } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { CalendarIcon, ClockIcon, PersonIcon, PinIcon } from '../../components/icons';
import { displayName } from '../../presentation/account';
import { periodLabel } from '../../presentation/dates';
import { availabilityLabel } from './presentation';

/**
 * Lo que viene DESPUÉS de la asignación en curso: el mes, dónde, quién y desde cuándo.
 *
 * No ofrece empezar, y esa es la diferencia con el héroe: la asignación de arriba se
 * empieza hoy, esta todavía no abrió. Lo único que ofrece es mirarla —las preguntas y la
 * plantilla, en solo lectura— para poder decidir con tiempo, sin descargar nada y sin
 * abrir un borrador de un mes que no empezó.
 *
 * Devuelve `null` la mayoría de los meses, y está bien: el trabajo automático abre un mes
 * por vez, así que solo existe una "próxima" cuando el coordinador programó por adelantado
 * (ver `nextAssignment`). Un marco vacío permanente se leería como algo que no cargó.
 */
export function NextAssignment({
  inspection,
  account,
  siteName,
}: {
  inspection: PendingInspection;
  account: Session;
  siteName: (id: string) => string;
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card__head">
        <h3>Next assignment</h3>
        <span className="status-pill status-pill--ready">Upcoming</span>
      </div>

      <dl className="facts">
        <div className="facts__item">
          <span className="facts__label">
            <CalendarIcon size={16} /> Month
          </span>
          <span className="facts__value">
            {periodLabel(inspection.period_start, inspection.period_months)}
          </span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <PinIcon size={16} /> Site
          </span>
          <span className="facts__value">{siteName(inspection.site_id)}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <PersonIcon size={16} /> Inspector
          </span>
          <span className="facts__value">{displayName(account)}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <ClockIcon size={16} /> Availability
          </span>
          <span className="facts__value">{availabilityLabel(inspection.period_start)}</span>
        </div>
      </dl>

      {/*
        `preview=1` y no la captura a secas: la ruta corta antes de tocar el dispositivo, así
        que abrir esto no crea un borrador ni marca el mes como empezado (ADR-001).
      */}
      <Link
        to="/inspections/$id/capture"
        params={{ id: inspection.id }}
        search={{ preview: '1' }}
        className="list__action list__action--block"
      >
        View assignment details →
      </Link>
    </div>
  );
}
