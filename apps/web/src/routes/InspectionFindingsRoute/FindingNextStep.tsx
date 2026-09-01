import type { Session } from "@hs/contracts";

import { useReturnToReportItem } from "../../components/ReportItem";
import { AdvanceActionForm } from "./AdvanceActionForm";
import { FindingAmendment } from "./FindingAmendment";
import type { FindingNextStep as NextStep } from "./presentation";

export function FindingNextStep({
  step,
  session,
  findingId,
  create,
  onDraftChange,
}: {
  step: NextStep;
  session: Session | null;
  findingId: string;
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
        onDone={returnFocus}
      />
    ) : null);

  return (
    <section className="finding__next-step" aria-label="Next step" ref={ref}>
      <div className="finding__next-step-copy">
        <p className="finding__next-step-eyebrow">Next step</p>
        <h3>{step.label}</h3>
        <p>{step.requirement}</p>
        <p className="finding__next-step-owner">
          {step.control ? "Responsible" : "Waiting on"}:{" "}
          <strong>{step.waitingOn}</strong>
        </p>
      </div>

      {form ? <div className="finding__next-step-form">{form}</div> : null}

      {step.amend ? (
        <FindingAmendment
          action={step.amend}
          findingId={findingId}
          onDraftChange={onDraftChange}
        />
      ) : null}
    </section>
  );
}
