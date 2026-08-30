import type { ActionSummary, Finding, Session } from '@hs/contracts';
import { useId, useState } from 'react';

import { FindingNextStep } from './FindingNextStep';
import { FindingStageRecord } from './FindingStageRecord';
import { FindingStepper } from './FindingStepper';
import {
  findingDeadline,
  type FindingNextStep as NextStep,
  type FindingStage,
} from './presentation';

/**
 * El ciclo de UN hallazgo: la tira de etapas y el panel que la etapa elegida abre.
 *
 * Existe como componente porque la etapa elegida es estado POR hallazgo y el ciclo se dibuja
 * dentro del recorrido de las preguntas: en la ruta, ese estado sería uno solo para todas las
 * fichas y elegir una etapa las movería todas.
 *
 * **El panel es uno y el hueco es el mismo.** Cada etapa abre lo que se decidió en ella, y la
 * vigente suma abajo su próximo paso: primero el registro, después lo que sigue. Que todas
 * compartan lugar es lo que hace que leer el pasado no agregue pantalla ni empuje el paso
 * fuera de la vista.
 *
 * **Avanzar devuelve la lectura a la etapa vigente**, y eso lo hace la `key` con la que la
 * ruta lo dibuja: si el hallazgo se movió mientras alguien leía una etapa pasada, quedarse
 * donde estaba dejaría la ficha mostrando un registro viejo justo después del acto que la
 * cambió, que es el momento en que hay que ver qué sigue.
 */
export function FindingLifecycle({
  finding,
  actions,
  step,
  session,
  today,
  onCreate,
}: {
  finding: Finding;
  /** Las acciones de ESTE hallazgo; vacío cuando la lista no se pudo leer. */
  actions: readonly ActionSummary[];
  step: NextStep | null;
  session: Session | null;
  today: string;
  onCreate?: React.MouseEventHandler<HTMLButtonElement>;
}): React.JSX.Element {
  const prefix = useId();
  const [selected, setSelected] = useState<FindingStage>(finding.state);
  const [drafting, setDrafting] = useState(false);

  const tabId = (stage: FindingStage): string => `${prefix}-${stage}`;
  const panelId = `${prefix}-panel`;
  const current = selected === finding.state;

  return (
    <>
      <FindingStepper
        current={finding.state}
        deadline={findingDeadline(actions, finding.state, today)}
        selected={selected}
        // Solo mientras el formulario que la escribiría está a la vista.
        draft={current ? (step?.writes ?? null) : null}
        locked={drafting}
        onSelect={setSelected}
        tabId={tabId}
        panelId={panelId}
      />

      {/*
        EL PANEL ES EL CONTENEDOR Y NO EL BLOQUE. El registro y el paso conservan cada uno su
        región con nombre propio —"Assigned record", "Next step"—, que es como se los nombra
        en pantalla y como se los busca; envolverlos deja además que la etapa vigente muestre
        los dos sin que el `tabpanel` deje de ser uno solo, que es lo que la pestaña controla.
      */}
      <div role="tabpanel" id={panelId} aria-labelledby={tabId(selected)} tabIndex={-1}>
        <FindingStageRecord stage={selected} finding={finding} actions={actions} />
        {current && step ? (
          <FindingNextStep
            step={step}
            session={session}
            findingId={finding.id}
            onAttempt={onCreate}
            onDraftChange={setDrafting}
          />
        ) : null}
      </div>
    </>
  );
}
