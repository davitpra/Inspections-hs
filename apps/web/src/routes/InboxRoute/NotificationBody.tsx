import { Link } from '@tanstack/react-router';
import type { Notification } from '@hs/contracts';

import { formatDay } from '../../presentation/dates';
import { CLASSIFICATION_LABELS } from '../../presentation/incidents';

/**
 * Qué dice un aviso, por tipo.
 *
 * **El `switch` es exhaustivo por tipo, y esa exhaustividad es el punto.**
 * `Notification` es una unión discriminada por `kind` (design D11): agregar un tipo sin
 * decir cómo se muestra es un error de compilación acá, no una tarjeta vacía en
 * producción. El `default` no existe por descuido — `never` es lo que fuerza el error.
 */
export function NotificationBody({
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
          {formatDay(notification.payload.due_at)}
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

    case 'incident_reported':
      // El aviso NO lleva el nombre del sujeto y por eso esta tarjeta tampoco lo muestra
      // (design D11): la bandeja se lee con otra regla de acceso que el incidente, y
      // seguir el enlace vuelve a pasar por la política — a quien no puede verlo, no le
      // devuelve nada.
      return (
        <Link to="/incidents/$id" params={{ id: notification.payload.incident_id }}>
          An incident was reported: {CLASSIFICATION_LABELS[notification.payload.classification]}{' '}
          — happened {formatDay(notification.payload.occurred_at)}
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
