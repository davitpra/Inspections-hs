import type {
  ActionSummary,
  Evidence,
  EvidenceKind,
  Finding,
} from "@hs/contracts";
import { useQuery } from "@tanstack/react-query";

import { getAction, getEvidenceDownload } from "../../api/actions";
import { queryKeys } from "../../api/query-keys";
import { decisionLabel } from "../../presentation/actions";
import { formatDay } from "../../presentation/dates";
import {
  acceptedClosureEvidence,
  eventsReadInStage,
  STAGE_LABELS,
  type FindingStage,
} from "./presentation";

const EVIDENCE_URL_STALE_TIME_MS = 4 * 60 * 1000;
const EVIDENCE_URL_EXPIRY_MARGIN_MS = 30 * 1000;

export function FindingStageRecord({
  stage,
  finding,
  actions,
  pending = false,
}: {
  stage: FindingStage;
  finding: Finding;
  actions: readonly ActionSummary[];
  pending?: boolean;
}): React.JSX.Element {
  return (
    <section
      className="finding__stage-record"
      aria-label={`${STAGE_LABELS[stage]} record`}
    >
      <p className="finding__stage-record-eyebrow">{STAGE_LABELS[stage]}</p>

      {/* La misma voz que la etapa alcanzada sin eventos: es la misma ausencia. */}
      {pending ? (
        <p className="finding__stage-record-eyebrow">
          No corrective action has been created yet. Assign someone and describe
          the work they need to complete.
        </p>
      ) : stage === "raised" ? (
        <dl className="finding__stage-record-facts">
          <div>
            <dt>Finding recorded date</dt>
            <dd>{formatDay(finding.recorded_at)}</dd>
          </div>
        </dl>
      ) : actions.length === 0 ? (
        <p className="notice notice--warn">
          The record of this stage needs a connection.
        </p>
      ) : (
        actions.map((action) => (
          <ActionStageRecord key={action.id} action={action} stage={stage} />
        ))
      )}
    </section>
  );
}

function ActionIdentity({
  action,
  title,
}: {
  action: ActionSummary;
  title: string;
}): React.JSX.Element {
  return (
    <>
      <p className="finding__stage-record-title">{title}</p>
      <dl className="finding__stage-decision-values">
        <div>
          <dt>Responsible</dt>
          <dd>{action.assignee_name ?? "Assigned person"}</dd>
        </div>
        <div>
          <dt>Work</dt>
          <dd>{action.description}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{formatDay(action.due_at)}</dd>
        </div>
      </dl>
    </>
  );
}

/** El aporte de UNA acción a la etapa elegida. */
function ActionStageRecord({
  action,
  stage,
}: {
  action: ActionSummary;
  stage: FindingStage;
}): React.JSX.Element {
  if (stage === "assigned") {
    return <ActionIdentity action={action} title="Current assignment" />;
  }

  return (
    <>
      <ActionIdentity action={action} title="Corrective action" />
      <StageEvents actionId={action.id} stage={stage} />
    </>
  );
}

function StageEvents({
  actionId,
  stage,
}: {
  actionId: string;
  stage: FindingStage;
}): React.JSX.Element | null {
  const detail = useQuery({
    queryKey: queryKeys.action(actionId),
    queryFn: () => getAction(actionId),
    retry: false,
  });

  if (detail.isPending) return <p>Loading the stage record…</p>;

  if (detail.isError || !detail.data) {
    return (
      <p className="notice notice--warn">
        The record of this stage needs a connection.
      </p>
    );
  }

  const events = eventsReadInStage(detail.data.events, stage);
  const closureEvidence = new Map(
    acceptedClosureEvidence(detail.data.events).map(
      ({ closureId, evidence }) => [closureId, evidence],
    ),
  );

  if (events.length === 0) {
    return (
      <p className="finding__stage-record-eyebrow">
        Nothing was recorded here yet.
      </p>
    );
  }

  return (
    <ol className="finding__stage-decisions">
      {events.map((event) => {
        const before = event.evidence.filter(
          (item) => item.kind === "before",
        ).length;
        const after = event.evidence.filter(
          (item) => item.kind === "after",
        ).length;

        return (
          <li key={event.id} className="finding__stage-decision">
            <p className="finding__stage-decision-step">
              {decisionLabel(event.from_state, event.to_state)}
            </p>
            {event.reason ? (
              <p className="finding__stage-decision-note">
                <span>Reason</span>
                {event.reason}
              </p>
            ) : null}
            {event.note ? (
              <p className="finding__stage-decision-note">
                <span>Note</span>
                {event.note}
              </p>
            ) : null}
            {event.evidence.length > 0 ? (
              <p className="finding__stage-decision-evidence">
                <span>Evidence</span>
                {before} before, {after} after
              </p>
            ) : null}
            {stage === "closed" ? (
              <AcceptedEvidenceGallery
                evidence={closureEvidence.get(event.id) ?? []}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function AcceptedEvidenceGallery({
  evidence,
}: {
  evidence: readonly Evidence[];
}): React.JSX.Element | null {
  if (evidence.length === 0) return null;

  return (
    <div
      className="finding__accepted-evidence"
      aria-label="Accepted evidence photographs"
    >
      {(["before", "after"] as const).map((kind) => {
        const photographs = evidence.filter((item) => item.kind === kind);

        if (photographs.length === 0) return null;

        const label = kind === "before" ? "Before" : "After";

        return (
          <section
            key={kind}
            className="finding__evidence-group"
            aria-label={`${label} photos`}
          >
            <h4>{label}</h4>
            <ul>
              {photographs.map((item, index) => (
                <li key={item.id}>
                  <EvidencePhoto
                    evidence={item}
                    kind={kind}
                    index={index + 1}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function EvidencePhoto({
  evidence,
  kind,
  index,
}: {
  evidence: Evidence;
  kind: EvidenceKind;
  index: number;
}): React.JSX.Element {
  const label = kind === "before" ? "Before" : "After";
  const download = useQuery({
    queryKey: queryKeys.actionEvidence(evidence.id),
    queryFn: () => getEvidenceDownload(evidence.id),
    retry: false,
    staleTime: ({ state }) => {
      if (!state.data) return 0;

      return Math.min(
        EVIDENCE_URL_STALE_TIME_MS,
        Math.max(
          0,
          Date.parse(state.data.expires_at) -
            Date.now() -
            EVIDENCE_URL_EXPIRY_MARGIN_MS,
        ),
      );
    },
    gcTime: EVIDENCE_URL_STALE_TIME_MS,
  });

  if (download.isPending) {
    return (
      <div className="finding__evidence-tile-state">
        Loading {label} photo {index}…
      </div>
    );
  }

  if (download.isError || !download.data) {
    return (
      <div
        className="finding__evidence-tile-state finding__evidence-tile-state--error"
        role="alert"
      >
        <span>
          {label} photo {index} could not be loaded.
        </span>
        <button
          type="button"
          className="button--outline"
          onClick={() => void download.refetch()}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <a
      className="finding__evidence-photo"
      href={download.data.url}
      target="_blank"
      rel="noreferrer"
    >
      <img src={download.data.url} alt={`${label} evidence photo ${index}`} />
    </a>
  );
}
