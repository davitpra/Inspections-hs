import { useId, useState } from "react";
import type { TemplateDraftItem } from "@hs/contracts";

import { Sheet } from "../../app/Sheet";
import {
  RESPONSE_TYPE_HINTS,
  RESPONSE_TYPE_LABELS,
} from "../../presentation/templates";
import {
  addItemOption,
  changeItemOption,
  configureItem,
  removeItemOption,
  setItemFinding,
} from "./edits";
import {
  defaultFinding,
  FAILURE_OPERATOR_OPTIONS,
  failureKind,
  hasConfiguration,
} from "./presentation";
import { ResponseTypeConfig } from "./ResponseTypeConfig";

type Finding = NonNullable<TemplateDraftItem["finding"]>;

/**
 * Todo lo que una pregunta declara sobre su respuesta: la configuración del tipo y la acción
 * correctiva, en un solo panel.
 *
 * **UN BORRADOR LOCAL DEL ÍTEM.** Nada de lo que se toca acá llega al documento hasta
 * «Save», que lo escribe de una vez; Escape, el fondo o el botón de cerrar descartan todo.
 * La configuración y la acción van juntas porque se leen juntas: un umbral solo tiene
 * sentido sabiendo el rango, y una acción solo sabiendo qué respuesta la dispara.
 *
 * La acción es opcional: una pregunta se configura sin prescribir nada, y por eso guardar
 * no exige haberla escrito.
 */
export function QuestionSheet({
  item,
  onClose,
  onSave,
}: {
  item: TemplateDraftItem;
  onClose: () => void;
  onSave: (item: TemplateDraftItem) => void;
}): React.JSX.Element {
  const controlId = useId();
  const [draft, setDraft] = useState<TemplateDraftItem>(item);
  const kind = failureKind(draft.response_type);
  const finding = draft.finding;

  const writeFinding = (next: Finding | null): void => {
    setDraft((current) => setItemFinding(current, next));
  };

  const update = (change: Partial<Finding>): void => {
    if (finding) writeFinding({ ...finding, ...change });
  };

  return (
    <Sheet side="end" label="Question settings" onClose={onClose}>
      <div className="finding-sheet__question">
        <span className="field-label">Question</span>
        <p>{draft.prompt.trim() || "Untitled question"}</p>
        <span className="field-label">Answer type</span>
        <p>{RESPONSE_TYPE_LABELS[draft.response_type]}</p>
      </div>

      {hasConfiguration(draft.response_type) ? (
        <section className="finding-sheet__settings">
          <h3 className="finding-sheet__heading">Answer settings</h3>
          <p className="note">{RESPONSE_TYPE_HINTS[draft.response_type]}</p>
          <ResponseTypeConfig
            item={draft}
            onNumber={(field, value) =>
              setDraft((current) => configureItem(current, field, value))
            }
            onOptions={{
              change: (optionIndex, change) =>
                setDraft((current) =>
                  changeItemOption(current, optionIndex, change),
                ),
              add: () => setDraft((current) => addItemOption(current)),
              remove: (optionIndex) =>
                setDraft((current) => removeItemOption(current, optionIndex)),
            }}
          />
        </section>
      ) : null}

      {/*
        Sin `aria-labelledby`: el título de la sección y el `<label>` del textarea dicen lo
        mismo, y dos elementos con el mismo nombre accesible confunden al lector.
      */}
      <section className="finding-sheet__settings">
        <h3 className="finding-sheet__heading">Corrective action</h3>

        {kind === "answer" ? (
          <p className="note">
            The action is prescribed whenever an inspector gives the answer set
            in Fails when answered.
          </p>
        ) : null}

        {kind === "none" ? (
          <p className="note">
            This answer type never creates a finding on its own, so this action
            will not be prescribed automatically.
          </p>
        ) : null}

        {finding && kind === "threshold" ? (
          <fieldset className="finding-sheet__threshold">
            <legend>When this question fails</legend>
            <label className="finding-sheet__check">
              <input
                type="checkbox"
                checked={finding.fails_when !== undefined}
                onChange={(event) => {
                  if (event.target.checked) {
                    update({
                      fails_when: defaultFinding(draft.response_type).fails_when,
                    });
                  } else {
                    const { fails_when: _failsWhen, ...withoutThreshold } =
                      finding;
                    writeFinding(withoutThreshold);
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

        {finding ? (
          <>
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
            <div>
              <button type="button" onClick={() => writeFinding(null)}>
                Remove corrective action
              </button>
            </div>
          </>
        ) : (
          <div>
            <button
              type="button"
              onClick={() =>
                writeFinding(defaultFinding(draft.response_type))
              }
            >
              Add corrective action
            </button>
          </div>
        )}
      </section>

      <div className="finding-sheet__actions">
        <button
          type="button"
          className="button--primary"
          onClick={() => onSave(draft)}
        >
          Save
        </button>
      </div>
    </Sheet>
  );
}
