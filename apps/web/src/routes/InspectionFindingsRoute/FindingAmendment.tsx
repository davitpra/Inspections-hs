import type { ActionSummary } from '@hs/contracts';
import { useState } from 'react';

import { EditAssignmentForm } from './EditAssignmentForm';

/**
 * Corregir el compromiso ya escrito: quién, qué y para cuándo (ADR-018).
 *
 * **ES LO ÚNICO PLEGADO DEL PASO, y esa asimetría es la regla.** El acto principal de la etapa
 * Assigned es empezar el trabajo, y su formulario está a la vista porque un disclosure costaba
 * dos pulsaciones para el único acto que la pantalla ofrece. Enmendar es la excepción: a la
 * vista serían tres campos compitiendo contra ese botón, en la etapa donde lo que hay que
 * hacer es arrancar. Se ofrece, no se propone.
 *
 * Mientras está abierto hay algo escrito, y el ciclo se avisa —`onDraftChange`— para que
 * elegir otra etapa no se lleve el borrador puesto.
 *
 * Se retira sola en cuanto alguien pulsa `Start work`: `nextStep` deja de traer `amend`, y el
 * compromiso pasa a ser historia de la etapa. El servidor vuelve a exigir las dos cosas —quién
 * puede enmendar y hasta cuándo—; esto es comodidad.
 */
export function FindingAmendment({
  action,
  findingId,
  onDraftChange,
}: {
  action: ActionSummary;
  findingId: string;
  onDraftChange?: (drafting: boolean) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);

  const toggle = (next: boolean): void => {
    setOpen(next);
    onDraftChange?.(next);
  };

  return (
    <div className="finding__amend">
      <button
        type="button"
        className="button--outline finding__amend-toggle"
        aria-expanded={open}
        onClick={() => toggle(!open)}
      >
        {open ? 'Cancel' : 'Edit assignment'}
      </button>
      {open ? (
        <EditAssignmentForm
          action={action}
          findingId={findingId}
          onAmended={() => toggle(false)}
        />
      ) : null}
    </div>
  );
}
