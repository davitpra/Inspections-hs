import { Link } from '@tanstack/react-router';

import type { DraftRow as DraftRowData } from '../../offline/db';
import { isDiscardable } from '../../offline/drafts';
import { draftLabel } from './presentation';

/**
 * Un borrador de este dispositivo: reanudarlo, y —mientras siga siendo un borrador—
 * descartarlo.
 *
 * El botón de descartar solo aparece en lo que todavía no salió (ADR-001: el envío es el
 * punto de no retorno). Una fila firmada no lo ofrece, y eso no es esconder una función:
 * es que ya no existe para ella, y por eso la etiqueta de la fila dice que está esperando
 * para enviarse en vez de callarlo.
 *
 * No borra: abre la confirmación, que la ruta monta fuera de esta lista.
 */
export function DraftRow({
  draft,
  onDiscard,
}: {
  draft: DraftRowData;
  onDiscard: (draft: DraftRowData) => void;
}): React.JSX.Element {
  return (
    <li className="list__row">
      <Link to="/inspections/$id/capture" params={{ id: draft.scheduled_inspection_id }}>
        {draftLabel(draft)}
      </Link>

      {isDiscardable(draft) ? (
        <button
          type="button"
          // El nombre accesible distingue una fila de otra: en una lista de borradores
          // que solo se diferencian por su fecha, cinco botones "Discard" son cinco
          // botones idénticos para quien navega por voz o con lector de pantalla.
          aria-label={`Discard the draft started ${draft.created_at.slice(0, 10)}`}
          onClick={() => onDiscard(draft)}
        >
          Discard
        </button>
      ) : null}
    </li>
  );
}
