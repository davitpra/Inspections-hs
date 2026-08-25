import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { listTemplates } from '../api/inspections';
import { queryKeys } from '../api/query-keys';
import {
  calendarLabel,
  inspectorLabel,
  missedNote,
  STATUS_LABELS,
  type YearEntry,
} from '../presentation/scheduling';

/**
 * El detalle de una casilla del calendario: QUÉ dice el registro de ese mes, nada más.
 *
 * SOLO LECTURA, a propósito. La matriz es la vista de cumplimiento, y una celda que se
 * abre para mirar no debería ser también el lugar donde se asigna, se abre o se cancela
 * un período: un clic exploratorio no puede terminar en una escritura que no se deshace.
 */
export function PeriodDialog({
  entry,
  year,
  onClose,
}: {
  entry: YearEntry;
  year: string;
  onClose: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const inspection = entry.kind === 'opened' ? entry.inspection : null;

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const close = () => {
    dialogRef.current?.close();
    returnFocusRef.current?.focus();
  };

  /*
    La versión publicada de hoy es lo que se congelaría al abrir el período; se nombra
    porque es información sobre la casilla, no un paso hacia una acción.
  */
  const templates = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    enabled: entry.kind === 'unopened',
    retry: false,
  });

  const template = entry.kind === 'unopened'
    ? templates.data?.find((option) => option.id === entry.period.template_id)
    : null;

  const title = entry.kind === 'opened'
    ? calendarLabel(entry.inspection.period_start, entry.inspection.period_months, year)
    : calendarLabel(entry.period.period_start, entry.period.period_months, year);
  const name = entry.kind === 'opened' ? entry.inspection.template_name : entry.period.template_name;

  return (
    <dialog ref={dialogRef} className="modal period-dialog" aria-label={`${title} period details`} onClose={() => { onClose(); returnFocusRef.current?.focus(); }}>
      <div className="modal__head"><h2>{title}</h2></div>
      <p className="modal__text">{name}</p>

      {inspection ? (
        <>
          <dl className="period-dialog__details">
            <div>
              <dt className="field-label">Status</dt>
              <dd><span className={`status-pill status-pill--${inspection.status}`}>{STATUS_LABELS[inspection.status]}</span></dd>
            </div>
            <div>
              <dt className="field-label">Inspector</dt>
              <dd>{inspectorLabel(inspection)}</dd>
            </div>
            {inspection.cancellation_reason ? (
              <div>
                <dt className="field-label">Cancellation reason</dt>
                <dd>{inspection.cancellation_reason}</dd>
              </div>
            ) : null}
          </dl>
          {missedNote(inspection) ? <p className="notice notice--warn">{missedNote(inspection)}</p> : null}
        </>
      ) : (
        <dl className="period-dialog__details">
          <div>
            <dt className="field-label">Status</dt>
            <dd><span className="status-pill status-pill--not-opened">Not opened</span></dd>
          </div>
          <div>
            <dt className="field-label">Published version</dt>
            <dd>{templates.isLoading ? 'Loading…' : templates.isError ? 'Unavailable' : template ? `Version ${template.latest_version} would be frozen when opened.` : 'No published version is available.'}</dd>
          </div>
        </dl>
      )}

      <div className="modal__actions period-dialog__actions">
        <button type="button" onClick={close}>Close</button>
      </div>
    </dialog>
  );
}
