import {
  FINDING_STAGES,
  STAGE_LABELS,
  stageStatus,
  type FindingStage,
} from './presentation';

/** Las cinco etapas escritas; el color solo acompaña el estado de cada segmento. */
export function FindingStepper({
  current,
  deadline,
}: {
  current: FindingStage;
  deadline: string | null;
}): React.JSX.Element {
  return (
    <section className="finding__lifecycle" aria-label="Finding lifecycle">
      <div className="finding__lifecycle-head">
        <h3>Finding lifecycle</h3>
        {deadline ? <p>{deadline}</p> : null}
      </div>
      <ol className="finding__stepper">
        {FINDING_STAGES.map((stage) => {
          const status = stageStatus(stage, current);

          return (
            <li
              key={stage}
              className={`finding__stage finding__stage--${status}`}
              aria-current={status === 'current' ? 'step' : undefined}
            >
              <span className="finding__stage-mark" aria-hidden="true" />
              <span>{STAGE_LABELS[stage]}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
