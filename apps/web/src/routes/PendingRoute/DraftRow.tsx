import { Link } from '@tanstack/react-router';

import { CalendarIcon } from '../../components/icons';
import type { DraftRow as DraftRowData } from '../../offline/db';
import { isDiscardable } from '../../offline/drafts';
import { monthName } from '../../presentation/dates';
import { draftCardClass, draftPillClass, statusLabel } from './presentation';

/**
 * Un borrador de este dispositivo: reanudarlo, y —mientras siga siendo un borrador—
 * descartarlo.
 *
 * Misma tarjeta que la inspección programada, con una diferencia honesta: el mes solo se
 * muestra cuando se pudo resolver contra la lista del servidor (ver `draftPeriodStart`).
 * Cuando no, el encabezado es la fecha en que se empezó, que es lo único que el
 * dispositivo sabe con certeza.
 *
 * El botón de descartar solo aparece en lo que todavía no salió (ADR-001: el envío es el
 * punto de no retorno). Una tarjeta firmada no lo ofrece, y eso no es esconder una
 * función: es que ya no existe para ella, y por eso la píldora dice que está esperando
 * para enviarse en vez de callarlo.
 *
 * No borra: abre la confirmación, que la ruta monta fuera de esta lista.
 */
export function DraftRow({
  draft,
  periodStart,
  onDiscard,
}: {
  draft: DraftRowData;
  periodStart: string | null;
  onDiscard: (draft: DraftRowData) => void;
}): React.JSX.Element {
  const started = draft.created_at.slice(0, 10);

  return (
    <li className={draftCardClass(draft.status)}>
      <div className="period__head">
        <span className="period__icon">
          <CalendarIcon />
        </span>

        <span className="period__title">
          <span className="period__month">
            {periodStart === null ? started : monthName(periodStart)}
          </span>
          <span className="period__status">
            {periodStart === null ? 'Started on this device' : `Started ${started}`}
          </span>
        </span>

        <span className="period__badges">
          <span className={draftPillClass(draft.status)}>{statusLabel(draft.status)}</span>
        </span>
      </div>

      <Link
        to="/inspections/$id/capture"
        params={{ id: draft.scheduled_inspection_id }}
        className="list__action period__action"
      >
        {draft.status === 'capturing' ? 'Resume inspection' : 'Open inspection'}
      </Link>

      {isDiscardable(draft) ? (
        <button
          type="button"
          // El nombre accesible distingue una tarjeta de otra: en una lista de borradores
          // que solo se diferencian por su fecha, cinco botones "Discard" son cinco
          // botones idénticos para quien navega por voz o con lector de pantalla.
          aria-label={`Discard the draft started ${started}`}
          onClick={() => onDiscard(draft)}
        >
          Discard
        </button>
      ) : null}
    </li>
  );
}
