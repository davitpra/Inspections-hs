import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { Notification } from '@hs/contracts';

import { listNotifications } from '../api/actions';
import { formatDate } from './action-permissions';

/**
 * La bandeja in-app. ADR-011 D9: no hay correo, así que este es el canal.
 *
 * **El `switch` de abajo es exhaustivo por tipo, y esa exhaustividad es el punto.**
 * `Notification` es una unión discriminada por `kind` (design D11): agregar un tipo sin
 * decir cómo se muestra es un error de compilación acá, no una tarjeta vacía en
 * producción. El `default` no existe por descuido — `never` es lo que fuerza el error.
 */
export function InboxRoute(): React.JSX.Element {
  const notifications = useQuery({
    queryKey: ['notifications'],
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
            <span className="badge">{formatDate(notification.created_at)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

function NotificationBody({
  notification,
}: {
  notification: Notification;
}): React.JSX.Element {
  switch (notification.kind) {
    case 'inspection_period_opened':
      return (
        <span>
          {notification.payload.opened.length} inspection
          {notification.payload.opened.length === 1 ? '' : 's'} opened for{' '}
          {notification.payload.period_start.slice(0, 7)}
        </span>
      );

    case 'corrective_action_assigned':
      return (
        <Link to="/actions/$id" params={{ id: notification.payload.action_id }}>
          You have a corrective action: {notification.payload.description} — due{' '}
          {formatDate(notification.payload.due_at)}
        </Link>
      );

    case 'corrective_action_overdue_supervisor':
    case 'corrective_action_overdue_management':
      return (
        <Link to="/actions/$id" params={{ id: notification.payload.action_id }}>
          Overdue by {notification.payload.days_overdue} days:{' '}
          {notification.payload.description}
        </Link>
      );

    default:
      // Inalcanzable mientras la unión esté cubierta. Si alguien agrega un `kind` al
      // contrato y no lo agrega acá, esto deja de compilar — que es exactamente lo que
      // se quiere que pase, y no una tarjeta en blanco que nadie sabe leer.
      return assertNever(notification);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled notification kind: ${JSON.stringify(value)}`);
}
