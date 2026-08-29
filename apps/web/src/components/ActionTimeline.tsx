import type { ActionEvent } from '@hs/contracts';

import { STATE_LABELS } from '../presentation/actions';
import { formatInstant } from '../presentation/dates';
import { CameraIcon, ListIcon } from './icons';

export function ActionTimeline({ events }: { events: readonly ActionEvent[] }): React.JSX.Element {
  return (
    <section className="card action-detail__history" aria-labelledby="action-history-heading">
      <div className="action-detail__section-head">
        <span className="action-detail__section-icon">
          <ListIcon size={20} />
        </span>
        <div>
          <h2 id="action-history-heading">History</h2>
          <p>{events.length} recorded {events.length === 1 ? 'event' : 'events'}</p>
        </div>
      </div>

      <ol className="action-detail__timeline">
        {events.map((event) => {
          const beforeCount = event.evidence.filter((item) => item.kind === 'before').length;
          const afterCount = event.evidence.filter((item) => item.kind === 'after').length;

          return (
            <li key={event.id} className="action-detail__event">
              <span className="action-detail__event-marker" aria-hidden="true" />
              <div className="action-detail__event-content">
                <div className="action-detail__event-head">
                  <strong>{STATE_LABELS[event.to_state]}</strong>
                  <time dateTime={event.occurred_at}>{formatInstant(event.occurred_at)}</time>
                </div>
                {event.reason ? (
                  <p className="action-detail__event-detail">
                    <span>Reason</span>
                    {event.reason}
                  </p>
                ) : null}
                {event.note ? <p className="action-detail__event-note">{event.note}</p> : null}
                {event.evidence.length > 0 ? (
                  <p className="action-detail__event-evidence">
                    <CameraIcon size={16} />
                    {beforeCount} before, {afterCount} after
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
