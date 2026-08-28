import type { PendingInspection } from '@hs/contracts';
import { useNavigate } from '@tanstack/react-router';

import { RowMenu, type RowAction } from '../../components/RowMenu';
import type { DraftRow as DraftRowData } from '../../offline/db';
import { isDiscardable } from '../../offline/drafts';
import { periodLabel } from '../../presentation/dates';
import { draftPillClass, statusLabel } from './presentation';

/**
 * El borrador local de ESTA asignación, si existe.
 *
 * Vive en la página de la inspección y no en la portada porque el borrador no es una
 * lista: es el estado de este recorrido en este dispositivo (ADR-001, un dueño y un
 * dispositivo). Lo que la tabla agrega sobre el héroe es lo que el héroe no dice —cuándo
 * se empezó y qué se le puede hacer— y sobre todo la única puerta para descartarlo.
 *
 * El nombre del requisito no es un link: la página YA es esa inspección.
 */
export function DeviceDrafts({
  draft,
  inspection,
  siteName,
  onDiscard,
}: {
  draft: DraftRowData | null;
  inspection: PendingInspection;
  siteName: string;
  onDiscard: (draft: DraftRowData) => void;
}): React.JSX.Element {
  const navigate = useNavigate();
  const started = draft?.created_at.slice(0, 10) ?? null;
  const actions: RowAction[] = [];

  if (draft) {
    actions.push({
      label: draft.status === 'capturing' ? 'Resume' : 'Open',
      onSelect: () =>
        void navigate({
          to: '/inspections/$id/capture',
          params: { id: draft.scheduled_inspection_id },
        }),
    });

    /*
      Descartar solo existe en lo que todavía no salió (ADR-001: el envío es el punto de
      no retorno). Un borrador ya firmado no lo ofrece, y por eso la píldora dice que está
      esperando para enviarse en vez de callarlo.
    */
    if (isDiscardable(draft)) {
      actions.push({
        label: 'Discard draft',
        tone: 'danger',
        onSelect: () => onDiscard(draft),
      });
    }
  }

  return (
    <section className="requirements-section device-drafts" aria-labelledby="drafts-heading">
      <div className="requirements-section__head">
        <div>
          <h2 id="drafts-heading">
            Draft on this device <span className="note">({draft ? 1 : 0})</span>
          </h2>
          <p className="note">Work started here that has not been sent yet.</p>
        </div>
      </div>

      {draft === null ? (
        <p className="schedule-empty">No draft in progress on this device.</p>
      ) : (
        <table className="table device-drafts__table" aria-label="Draft on this device">
          <thead>
            <tr>
              <th scope="col">Period</th>
              <th scope="col">Requirement</th>
              <th scope="col">Site</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row" data-label="Period">
                {periodLabel(inspection.period_start, inspection.period_months)}
              </th>
              <td data-label="Requirement">{inspection.template_name}</td>
              <td data-label="Site">{siteName}</td>
              <td data-label="Status">
                <span className={draftPillClass(draft.status)}>{statusLabel(draft.status)}</span>
              </td>

              {/*
                Todo lo que se le puede hacer a la fila vive en el «⋮», como en el roster y
                en la consola de plantillas: la celda queda del ancho de su encabezado y la
                tabla se lee de corrido.
              */}
              <td data-label="Actions" className="device-drafts__action">
                <div className="table__actions">
                  <RowMenu label={`More actions for the draft started ${started}`} actions={actions} />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}
