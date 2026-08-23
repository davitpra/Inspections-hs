import { useId, useState } from "react";
import type { ResponseType, TemplateDraftItem } from "@hs/contracts";

import { Sheet } from "../../app/Sheet";
import { RESPONSE_TYPE_LABELS } from "../../presentation/templates";
import {
  defaultFinding,
  FAILURE_OPERATOR_OPTIONS,
} from "./presentation";

type Finding = NonNullable<TemplateDraftItem["finding"]>;

function isMeasured(responseType: ResponseType): boolean {
  return responseType === "scale" || responseType === "number";
}

/** Editor local: Escape cancela y confirmar escribe todo el bloque una sola vez. */
export function FindingSheet({
  item,
  onClose,
  onSave,
}: {
  item: TemplateDraftItem;
  onClose: () => void;
  onSave: (finding: Finding | null) => void;
}): React.JSX.Element {
  const controlId = useId();
  const [finding, setFinding] = useState<Finding>(
    () => item.finding ?? defaultFinding(item.response_type),
  );
  const measured = isMeasured(item.response_type);

  const update = (change: Partial<Finding>): void => {
    setFinding((current) => ({ ...current, ...change }));
  };

  return (
    <Sheet side="end" label="Finding prescription" onClose={onClose}>
      <div className="finding-sheet__question">
        <span className="field-label">Question</span>
        <p>{item.prompt.trim() || "Untitled question"}</p>
        <span className="field-label">Answer type</span>
        <p>{RESPONSE_TYPE_LABELS[item.response_type]}</p>
      </div>

      {measured ? (
        <fieldset className="finding-sheet__threshold">
          <legend>Failure threshold</legend>
          <label className="finding-sheet__check">
            <input
              type="checkbox"
              checked={finding.fails_when !== undefined}
              onChange={(event) => {
                if (event.target.checked) {
                  update({
                    fails_when: defaultFinding(item.response_type).fails_when,
                  });
                } else {
                  const { fails_when: _failsWhen, ...withoutThreshold } =
                    finding;
                  setFinding(withoutThreshold);
                }
              }}
            />
            Set a threshold for this question
          </label>

          {finding.fails_when ? (
            <div className="finding-sheet__threshold-fields">
              <div className="finding-sheet__field">
                <label
                  className="field-label"
                  htmlFor={`${controlId}-operator`}
                >
                  Operator
                </label>
                <select
                  id={`${controlId}-operator`}
                  value={finding.fails_when.operator}
                  onChange={(event) =>
                    update({
                      fails_when: {
                        ...finding.fails_when!,
                        operator: event.target.value as NonNullable<
                          Finding["fails_when"]
                        >["operator"],
                      },
                    })
                  }
                >
                  {FAILURE_OPERATOR_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="finding-sheet__field">
                <label className="field-label" htmlFor={`${controlId}-value`}>
                  Threshold value
                </label>
                <input
                  id={`${controlId}-value`}
                  type="number"
                  value={finding.fails_when.value}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (!Number.isNaN(value)) {
                      update({ fails_when: { ...finding.fails_when!, value } });
                    }
                  }}
                />
              </div>
            </div>
          ) : null}
          <p className="note">
            This threshold is recorded for future use. It does not create a
            finding yet.
          </p>
        </fieldset>
      ) : null}

      <div className="finding-sheet__field">
        <label className="field-label" htmlFor={`${controlId}-action`}>
          Corrective action
        </label>
        <textarea
          id={`${controlId}-action`}
          value={finding.corrective_action}
          onChange={(event) =>
            update({ corrective_action: event.target.value })
          }
          rows={5}
          placeholder="Describe what must be done when this question fails."
        />
      </div>

      <div className="finding-sheet__actions">
        {item.finding ? (
          <button type="button" onClick={() => onSave(null)}>
            Remove finding
          </button>
        ) : null}
        <button
          type="button"
          className="button--primary"
          onClick={() => onSave(finding)}
        >
          Save finding
        </button>
      </div>
    </Sheet>
  );
}
