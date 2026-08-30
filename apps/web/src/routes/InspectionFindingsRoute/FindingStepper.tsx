import { useRef } from 'react';

import {
  FINDING_STAGES,
  STAGE_LABELS,
  reachedStages,
  stageStatus,
  type FindingStage,
} from './presentation';

/**
 * Las cinco etapas escritas, y la etapa alcanzada COMO CONTROL.
 *
 * El color solo acompaña; lo que cada segmento dice está en su nombre y en su forma. Lo que
 * el segmento agrega ahora es poder abrirlo: elegir una etapa ya ocurrida cambia el panel de
 * abajo por lo que se decidió en ella, sin sacar el hallazgo de la pantalla ni mover el ciclo.
 *
 * **Es un `tablist` de verdad y no una lista con botones.** Quien navega con lector de
 * pantalla necesita oír que hay cinco pestañas y cuál está abierta (`aria-selected`), y eso es
 * distinto de dónde está el hallazgo (`aria-current`), que no se mueve al leer una etapa
 * pasada. Las dos cosas conviven en el mismo botón a propósito.
 *
 * Las etapas por delante NO son controles: no están vacías, no ocurrieron, y ofrecerlas
 * prometería una lectura que no existe.
 */
export function FindingStepper({
  current,
  deadline,
  selected,
  draft,
  locked,
  onSelect,
  tabId,
  panelId,
}: {
  current: FindingStage;
  deadline: string | null;
  selected: FindingStage;
  /** La etapa que el formulario a la vista escribiría y que todavía no ocurrió. */
  draft: FindingStage | null;
  /** Con un borrador abierto no se elige etapa: el formulario se perdería al cambiar de panel. */
  locked: boolean;
  onSelect: (stage: FindingStage) => void;
  tabId: (stage: FindingStage) => string;
  panelId: string;
}): React.JSX.Element {
  const tabs = useRef(new Map<FindingStage, HTMLButtonElement>());
  const reached = reachedStages(current);

  /*
    Las flechas mueven la selección entre las etapas alcanzadas, y el foco con ella. El
    `tabIndex` móvil deja al tablist entero como una sola parada del tabulador: dentro se
    navega con flechas, que es lo que un lector de pantalla anuncia al entrar.
  */
  const step = (event: React.KeyboardEvent<HTMLOListElement>): void => {
    const index = reached.indexOf(selected);
    const next =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? reached[index + 1]
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? reached[index - 1]
          : event.key === 'Home'
            ? reached[0]
            : event.key === 'End'
              ? reached[reached.length - 1]
              : undefined;

    if (!next || locked) return;

    event.preventDefault();
    onSelect(next);
    tabs.current.get(next)?.focus();
  };

  return (
    <section className="finding__lifecycle" aria-label="Finding lifecycle">
      <div className="finding__lifecycle-head">
        <h3>Finding lifecycle</h3>
        {deadline ? <p>{deadline}</p> : null}
      </div>
      <ol
        className="finding__stepper"
        role="tablist"
        aria-label="Finding stages"
        onKeyDown={step}
      >
        {FINDING_STAGES.map((stage) => {
          const status = stageStatus(stage, current);
          const mark = (
            <>
              <span className="finding__stage-mark" aria-hidden="true" />
              <span>{STAGE_LABELS[stage]}</span>
            </>
          );

          return (
            <li
              key={stage}
              role="presentation"
              className={`finding__stage finding__stage--${status}${
                stage === draft ? ' finding__stage--draft' : ''
              }`}
            >
              {status === 'todo' ? (
                mark
              ) : (
                <button
                  type="button"
                  role="tab"
                  id={tabId(stage)}
                  className="finding__stage-tab"
                  aria-selected={stage === selected}
                  aria-controls={panelId}
                  aria-current={status === 'current' ? 'step' : undefined}
                  tabIndex={stage === selected ? 0 : -1}
                  disabled={locked}
                  ref={(node) => {
                    if (node) tabs.current.set(stage, node);
                    else tabs.current.delete(stage);
                  }}
                  onClick={() => onSelect(stage)}
                >
                  {mark}
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
