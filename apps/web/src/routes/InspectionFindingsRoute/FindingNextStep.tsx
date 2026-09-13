import type { Finding, Session } from "@hs/contracts";

import { useReturnToReportItem } from "../../components/ReportItem";
import { AdvanceActionForm } from "./AdvanceActionForm";
import { FindingAssignmentEditor } from "./FindingAssignmentEditor";
import type { FindingNextStep as NextStep } from "./presentation";

export function FindingNextStep({
  step,
  session,
  findingId,
  finding,
  create,
  onDraftChange,
}: {
  step: NextStep;
  session: Session | null;
  findingId: string;
  finding: Pick<Finding, "reported_by">;
  /** El formulario que escribe el compromiso, cuando crear ES el paso; lo arma el ciclo. */
  create?: React.ReactNode;
  onDraftChange?: (drafting: boolean) => void;
}): React.JSX.Element {
  const { ref, returnFocus } = useReturnToReportItem<HTMLElement>();

  const form =
    create ??
    (step.control?.kind === "progress" ? (
      <AdvanceActionForm
        action={step.control.action}
        session={session}
        finding={finding}
        onDone={returnFocus}
      />
    ) : null);

  return (
    <section className="finding__next-step" aria-label="Next step" ref={ref}>
      <div className="finding__next-step-copy">
        <h3>{step.label}</h3>
        {step.waitingOn !== undefined ? (
          <p>Waiting on {step.waitingOn ?? "the assigned person"}</p>
        ) : null}
      </div>

      {step.editableAssignment ? (
        <FindingAssignmentEditor
          action={step.editableAssignment}
          findingId={findingId}
          onDraftChange={onDraftChange}
        />
      ) : null}

      {form ? <div className="finding__next-step-form">{form}</div> : null}
    </section>
  );
}
