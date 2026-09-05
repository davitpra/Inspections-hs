import { useState } from "react";
import type { InspectionSchedule } from "@hs/contracts";

import { PlusIcon } from "../../components/icons";
import { currentRules } from "../../presentation/scheduling";
import { RequirementConfirmDialog } from "./RequirementConfirmDialog";
import { RequirementDialog } from "./RequirementDialog";
import { RequirementRow } from "./RequirementRow";

/** Misma mesa que las plantillas publicadas: la tabla es el cuerpo de una sola tarjeta. */
export function RequirementsSection({
  rules,
  siteId,
  canAdminister,
  ready,
}: {
  rules: readonly InspectionSchedule[];
  siteId: string;
  canAdminister: boolean;
  ready: boolean;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<{
    rule: InspectionSchedule;
    kind: "deactivate" | "archive";
  } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archived = rules.filter((rule) => rule.archived_at !== null);
  const current = currentRules(
    rules.filter((rule) => rule.archived_at === null),
  );
  const visible = canAdminister
    ? showArchived
      ? [...current, ...archived]
      : current
    : [...current, ...archived];

  return (
    <section
      className="requirements-section"
      aria-labelledby="requirements-heading"
    >
      <div className="requirements-section__head">
        <div>
          <h2 id="requirements-heading">
            Inspection requirements{" "}
            <span className="note" aria-hidden="true">
              ({visible.length})
            </span>
          </h2>
          <p className="note">
            Each requirement creates the periods this site owes.
          </p>
        </div>
        {canAdminister ? (
          <div className="requirements-section__controls">
            {archived.length > 0 ? (
              <label className="archive-toggle">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(event) => setShowArchived(event.target.checked)}
                />{" "}
                Show archived
              </label>
            ) : null}
            <button
              type="button"
              className="button--primary requirements-section__add"
              onClick={() => setAdding(true)}
            >
              <PlusIcon /> Add Inspection
            </button>
          </div>
        ) : null}
      </div>

      {ready && visible.length === 0 ? (
        <p className="schedule-empty">
          No current inspection requirements are configured for this site.
        </p>
      ) : null}

      {visible.length > 0 ? (
        <table
          className="table requirements-table"
          aria-label="Inspection requirements"
        >
          <thead>
            <tr>
              <th scope="col">Requirement</th>
              <th scope="col">Frequency</th>
              <th scope="col">Default inspector</th>
              <th scope="col">Status</th>
              {canAdminister ? <th scope="col">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {visible.map((rule) => (
              <RequirementRow
                key={rule.id}
                rule={rule}
                canAdminister={canAdminister}
                onConfirm={(kind) => setConfirming({ rule, kind })}
              />
            ))}
          </tbody>
        </table>
      ) : null}

      {adding ? (
        <RequirementDialog
          siteId={siteId}
          rules={rules}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {confirming ? (
        <RequirementConfirmDialog
          rule={confirming.rule}
          kind={confirming.kind}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </section>
  );
}
