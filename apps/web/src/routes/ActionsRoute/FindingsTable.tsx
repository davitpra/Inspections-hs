import type { Finding } from '@hs/contracts';
import { useRef, useState } from 'react';

import { AlertCircleIcon, ListIcon, PlusIcon } from '../../components/icons';
import { formatInstant } from '../../presentation/dates';
import { CreateActionForm } from './CreateActionForm';
import type { FindingActionRow } from './presentation';

export function FindingsTable({
  rows,
  findingsLoading,
  findingsError,
  actionCountsAvailable,
  allowCreation,
}: {
  rows: readonly FindingActionRow[];
  findingsLoading: boolean;
  findingsError: boolean;
  actionCountsAvailable: boolean;
  allowCreation: boolean;
}): React.JSX.Element {
  const [selectedFinding, setSelectedFinding] = useState<Finding | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  return (
    <section className="card actions-overview__section" aria-labelledby="findings-heading">
      <div className="actions-overview__section-head">
        <div>
          <p className="actions-overview__eyebrow">Starting point</p>
          <h2 id="findings-heading">Findings</h2>
          <p>Turn an observed issue into an assigned, time-bound commitment.</p>
        </div>
        {!findingsLoading && !findingsError ? (
          <span className="actions-overview__count">{rows.length} {rows.length === 1 ? 'finding' : 'findings'}</span>
        ) : null}
      </div>
      {findingsError ? (
        <p className="status-card status-card--error"><AlertCircleIcon size={20} /> Findings need a connection.</p>
      ) : null}
      {findingsLoading ? (
        <p className="status-card"><ListIcon size={20} /> Loading findings…</p>
      ) : null}
      {!findingsLoading && !findingsError && rows.length === 0 ? (
        <div className="actions-overview__empty">
          <span className="actions-overview__empty-icon"><ListIcon size={24} /></span>
          <strong>No findings recorded</strong>
          <p>No findings have been recorded for your sites.</p>
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="actions-overview__table-wrap">
          <table className="table actions-table actions-overview__table">
            <caption className="table__caption">
              Findings stay available when they already have corrective actions.
            </caption>
            <thead>
              <tr>
                <th scope="col">Finding</th>
                <th scope="col">Origin</th>
                <th scope="col">Occurred</th>
                <th scope="col">Actions</th>
                {allowCreation ? <th scope="col"><span className="sr-only">Create</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ finding, actionCount }) => (
                <tr key={finding.id}>
                  <th scope="row" data-label="Finding" className="actions-overview__primary-cell">
                    {finding.description}
                  </th>
                  <td data-label="Origin">
                    <span className="actions-overview__source">{finding.origin === 'inspection' ? 'Inspection' : 'Manual'}</span>
                  </td>
                  <td data-label="Occurred">{formatInstant(finding.occurred_at)}</td>
                  <td data-label="Actions">
                    <span className="actions-overview__number">
                      {actionCountsAvailable ? actionCount : 'Unavailable'}
                    </span>
                  </td>
                  {allowCreation ? (
                    <td data-label="Create" className="actions-overview__action-cell">
                      <div className="table__actions">
                        <button
                          type="button"
                          className="actions-overview__create-button"
                          onClick={(event) => {
                            triggerRef.current = event.currentTarget;
                            setSelectedFinding(finding);
                          }}
                        >
                          <PlusIcon size={16} /> Create action
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {selectedFinding ? (
        <CreateActionForm
          finding={selectedFinding}
          returnFocusTo={triggerRef}
          onClose={() => setSelectedFinding(null)}
        />
      ) : null}
    </section>
  );
}
