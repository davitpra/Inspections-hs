import { CalendarIcon, CheckIcon, InfoIcon, PersonIcon, PinIcon } from '../../components/icons';

/**
 * El estado vacío del mes: no hay nada roto, no hay nada que hacer. Con la misma
 * silueta de tarjetas que el resto de la pantalla, para que "nada pendiente" se lea con
 * la misma confianza que una asignación resuelta, y no como una pantalla a medio cargar.
 *
 * La próxima asignación NO se dibuja acá: la tarjeta que la nombra la compone la ruta, y
 * es la misma con o sin asignación en curso. Tenerla en los dos lugares hacía que el mismo
 * hecho se contara distinto según el estado de la pantalla.
 */
export function NoAssignment({
  currentSiteId,
  monthLabel,
  siteName,
}: {
  currentSiteId: string;
  monthLabel: string;
  siteName: (id: string) => string;
}): React.JSX.Element {
  return (
    <div className="assignment">
      <div className="notice-card">
        <div className="notice-card__body">
          <span className="notice-card__icon">
            <CalendarIcon size={28} />
          </span>
          <div>
            <p className="notice-card__title">No inspection assigned this month</p>
            <p className="notice-card__text">
              You're not scheduled to complete a workplace inspection for {monthLabel}. No
              action is required right now.
            </p>
          </div>
        </div>
        <span className="status-pill status-pill--not-opened">Not assigned</span>
      </div>

      <dl className="facts">
        <div className="facts__item">
          <span className="facts__label">
            <PinIcon size={16} /> Site
          </span>
          <span className="facts__value">{siteName(currentSiteId)}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <CalendarIcon size={16} /> Current month
          </span>
          <span className="facts__value">{monthLabel}</span>
        </div>

        <div className="facts__item">
          <span className="facts__label">
            <PersonIcon size={16} /> Assignment status
          </span>
          <span className="status-pill status-pill--not-opened">Not assigned</span>
        </div>
      </dl>

      <div className="card">
        <h3>What happens next</h3>
        <ul className="checklist">
          <li>
            <CheckIcon size={16} /> When a new inspection is assigned, it will appear here
            automatically.
          </li>
          <li>
            <CheckIcon size={16} /> Once the month opens, you can start and save progress as
            you go.
          </li>
        </ul>
      </div>

      <p className="status-card">
        <InfoIcon size={20} /> If you have questions about your assignments, reach out to the
        Health &amp; Safety Coordinator.
      </p>
    </div>
  );
}
