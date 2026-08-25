import { Link } from '@tanstack/react-router';

import type { DraftRow as DraftRowData } from '../../offline/db';
import { isDiscardable } from '../../offline/drafts';
import { monthName } from '../../presentation/dates';
import { draftPillClass, statusLabel } from './presentation';

export function DeviceDrafts({
  drafts,
  periodStart,
  siteName,
  onDiscard,
}: {
  drafts: readonly DraftRowData[];
  periodStart: (draft: DraftRowData) => string | null;
  siteName: (id: string) => string;
  onDiscard: (draft: DraftRowData) => void;
}): React.JSX.Element {
  return (
    <div className="card">
      <div className="card__head">
        <h3>Drafts on this device</h3>
      </div>

      {drafts.length === 0 ? (
        <p className="note">No drafts in progress on this device.</p>
      ) : null}

      {drafts.length > 0 ? (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Site</th>
              <th scope="col">Status</th>
              <th scope="col">Started</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((draft) => {
              const started = draft.created_at.slice(0, 10);
              const period = periodStart(draft);

              return (
                <tr key={draft.client_submission_id}>
                  <th scope="row">
                    {period === null
                      ? started
                      : `${monthName(period)} ${period.slice(0, 4)}`}
                  </th>
                  <td>{siteName(draft.site_id)}</td>
                  <td>
                    <span className={draftPillClass(draft.status)}>
                      {statusLabel(draft.status)}
                    </span>
                  </td>
                  <td>
                    {period === null ? 'Started on this device' : `Started ${started}`}
                  </td>

                  <td>
                    <div className="table__actions">
                      <Link
                        to="/inspections/$id/capture"
                        params={{ id: draft.scheduled_inspection_id }}
                        className="list__action"
                      >
                        {draft.status === 'capturing' ? 'Resume' : 'Open'}
                      </Link>

                      {/*
                        Descartar solo existe en lo que todavía no salió (ADR-001: el envío
                        es el punto de no retorno). Una fila firmada no lo ofrece, y por eso
                        la píldora dice que está esperando para enviarse en vez de callarlo.
                      */}
                      {isDiscardable(draft) ? (
                        <button
                          type="button"
                          className="button--danger-quiet"
                          aria-label={`Discard the draft started ${started}`}
                          onClick={() => onDiscard(draft)}
                        >
                          Discard
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
