import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';

import { getAction } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { ActionProgressPanel } from '../../components/ActionProgressPanel';
import { ActionTimeline } from '../../components/ActionTimeline';
import { StateBadge } from '../../components/StateBadge';
import { AlertCircleIcon, CalendarIcon } from '../../components/icons';
import {
  actionDeadlineStatus,
  ACTION_DEADLINE_LABEL,
  escalationSummary,
} from '../../presentation/actions';
import { formatDay } from '../../presentation/dates';

export function ActionRoute(): React.JSX.Element {
  const { id } = useParams({ from: '/actions/$id' });
  const { account } = useAppSession();
  const action = useQuery({
    queryKey: queryKeys.action(id),
    queryFn: () => getAction(id),
    retry: false,
  });

  if (action.isError) return <p className="notice">This action needs a connection.</p>;
  if (!action.data) return <p>Loading…</p>;

  const current = action.data;
  const deadlineStatus = actionDeadlineStatus(current.overdue, current.state);
  const escalation = escalationSummary(current.escalations);

  return (
    <div className="action-detail">
      <nav className="action-detail__nav" aria-label="Breadcrumb">
        <Link to="/actions" className="back-link">Back to corrective actions</Link>
      </nav>

      <header className="action-detail__head">
        <div className="action-detail__title">
          <p className="action-detail__eyebrow">Corrective action</p>
          <h1>{current.description}</h1>
        </div>
        <div className="action-detail__summary">
          <StateBadge state={current.state} />
          <p className="action-detail__due">
            <CalendarIcon size={18} />
            <span>
              <span className="action-detail__due-label">{ACTION_DEADLINE_LABEL}</span>
              <strong>{formatDay(current.due_at)}</strong>
            </span>
          </p>
          {deadlineStatus ? <span className="badge badge--overdue">{deadlineStatus}</span> : null}
        </div>
      </header>

      {escalation ? (
        <div className="notice notice--warn action-detail__escalation">
          <AlertCircleIcon size={20} />
          <p><strong>Escalated</strong><span>{escalation}</span></p>
        </div>
      ) : null}

      <div className="action-detail__layout">
        <ActionTimeline events={current.events} />
        <aside className="action-detail__aside">
          <ActionProgressPanel action={current} session={account} />
        </aside>
      </div>
    </div>
  );
}
