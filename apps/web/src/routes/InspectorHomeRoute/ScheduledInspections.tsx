import type { PendingInspection } from "@hs/contracts";

import type { DraftRow } from "../../offline/db";
import { civilToday } from "../../presentation/dates";
import { ScheduledInspectionRow } from "./ScheduledInspectionRow";
import { scheduledInspectionRows } from "./presentation";

interface ScheduledInspectionsProps {
  inspections?: readonly PendingInspection[];
  drafts: readonly DraftRow[];
  siteName: (id: string) => string;
  loading: boolean;
  remoteError: boolean;
  draftsError: boolean;
  ready: boolean;
}

export function ScheduledInspections({
  inspections,
  drafts,
  siteName,
  loading,
  remoteError,
  draftsError,
  ready,
}: ScheduledInspectionsProps): React.JSX.Element {
  const rows = scheduledInspectionRows(inspections ?? [], civilToday());

  return (
    <section
      className="requirements-section scheduled-inspections"
      aria-labelledby="scheduled-heading"
    >
      <div className="requirements-section__head">
        <div>
          <h2 id="scheduled-heading">
            Scheduled inspections{" "}
            {inspections ? <span className="note">({rows.length})</span> : null}
          </h2>
          <p className="note">
            Every inspection assigned to you that still needs to be sent.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="schedule-empty">Loading scheduled inspections…</p>
      ) : null}
      {remoteError ? (
        <p className="notice notice--warn" role="alert">
          Scheduled inspections need a connection. Try again when you are
          online.
        </p>
      ) : null}
      {draftsError ? (
        <p className="notice notice--warn" role="alert">
          Drafts on this device could not be read.
        </p>
      ) : null}
      {ready && rows.length === 0 ? (
        <p className="schedule-empty">Nothing is scheduled for you.</p>
      ) : null}

      {ready && rows.length > 0 ? (
        <table
          className="table scheduled-inspections__table"
          aria-label="Scheduled inspections"
        >
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Inspection</th>
              <th scope="col">Site</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <ScheduledInspectionRow
                key={row.inspection.id}
                row={row}
                siteName={siteName(row.inspection.site_id)}
                drafts={drafts}
              />
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
