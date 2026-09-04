import type { ActionSummary } from '@hs/contracts';
import { useState } from 'react';

import { EditAssignmentForm } from './EditAssignmentForm';

/**
 * Corregir la asignación vigente: quién, qué y para cuándo (ADR-020).
 *
 * **ES LO ÚNICO PLEGADO DEL PASO, y esa asimetría es la regla.** El acto principal de la etapa
 * Assigned es empezar el trabajo, y su formulario está a la vista porque un disclosure costaba
 * dos pulsaciones para el único acto que la pantalla ofrece. Editar es la excepción: a la
 * vista serían tres campos compitiendo contra ese botón, en la etapa donde lo que hay que
 * hacer es arrancar. Se ofrece, no se propone.
 *
 * Mientras está abierto hay algo escrito, y el ciclo se avisa —`onDraftChange`— para que
 * elegir otra etapa no se lleve el borrador puesto.
 *
 * Se retira al cerrar la acción. El servidor vuelve a exigir quién puede editar y la frontera
 * `closed`; esto es comodidad.
 */
export function FindingAssignmentEditor({
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
    <div className="finding__assignment-editor">
      <button
        type="button"
        className="button--outline finding__assignment-editor-toggle"
        aria-expanded={open}
        onClick={() => toggle(!open)}
      >
        {open ? 'Cancel' : 'Edit assignment'}
      </button>
      {open ? (
        <EditAssignmentForm
          action={action}
          findingId={findingId}
          onSaved={() => toggle(false)}
        />
      ) : null}
    </div>
  );
}
