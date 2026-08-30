import type { Action, Session } from '@hs/contracts';

import { ActionTransitionForm } from './ActionTransitionForm';
import { CheckCircleIcon } from './icons';

export function ActionProgressPanel({
  action,
  session,
}: {
  action: Action;
  session: Session | null;
}): React.JSX.Element {
  if (action.state === 'closed') {
    return (
      <section className="card action-detail__closed">
        <span className="action-detail__closed-icon">
          <CheckCircleIcon size={24} />
        </span>
        <div>
          <h2>Action closed</h2>
          <p>Work that comes undone is reported as a new finding.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="card action-detail__work" aria-labelledby="action-next-heading">
      <div className="action-detail__section-head">
        <div>
          <p className="action-detail__eyebrow">Next step</p>
          <h2 id="action-next-heading">What now</h2>
        </div>
      </div>

      <ActionTransitionForm action={action} session={session} />
    </section>
  );
}
