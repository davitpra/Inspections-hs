import { useQuery } from '@tanstack/react-query';

import { listNotifications } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { formatDay } from '../../presentation/dates';
import { NotificationBody } from './NotificationBody';

/**
 * La bandeja in-app. ADR-011 D9: no hay correo, así que este es el canal.
 *
 * La fila es la misma para todo tipo de aviso —cuerpo y fecha—; qué dice el cuerpo lo
 * decide `NotificationBody`, exhaustivamente por `kind`.
 */
export function InboxRoute(): React.JSX.Element {
  const notifications = useQuery({
    queryKey: queryKeys.notifications(),
    queryFn: listNotifications,
    retry: false,
  });

  const rows = notifications.data ?? [];

  return (
    <>
      <h1>Inbox</h1>

      {notifications.isError ? <p className="notice">The inbox needs a connection.</p> : null}

      {notifications.isSuccess && rows.length === 0 ? <p>Nothing new.</p> : null}

      <ul className="list">
        {rows.map((notification) => (
          <li
            key={notification.id}
            className={notification.read_at === null ? 'list__row list__row--unread' : 'list__row'}
          >
            <NotificationBody notification={notification} />
            <span className="badge">{formatDay(notification.created_at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
