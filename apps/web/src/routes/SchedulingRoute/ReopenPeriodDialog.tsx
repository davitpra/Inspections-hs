import { useEffect, useRef } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { periodLabel } from '../../presentation/dates';
import { OpenPeriodForm } from './OpenPeriodForm';

/**
 * Volver a programar un mes cancelado.
 *
 * NO DESHACE LA CANCELACIÓN: el trigger de 0008 rechaza limpiar `cancelled_at` y su HINT
 * dice qué hacer en su lugar, que es esto — una fila nueva, con la versión de plantilla
 * publicada hoy y no la que llevaba la cancelada. Por eso el diálogo lo dice antes de
 * ofrecer el botón: quien lo abre viene de "reactivar" y se lleva otra cosa.
 *
 * Modal y no un formulario en la tarjeta, por lo mismo que cancelar: la fila cancelada se
 * lee doce veces en el año y este es el caso raro. El motivo de la cancelación queda a la
 * vista mientras se decide.
 */
export function ReopenPeriodDialog({
  inspection,
  siteId,
  onClose,
}: {
  inspection: ScheduledInspection;
  siteId: string;
  onClose: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} className="modal" aria-label="Schedule period again" onClose={() => { onClose(); returnFocusRef.current?.focus(); }}>
      <div className="modal__head"><h2>
        Schedule {periodLabel(inspection.period_start, inspection.period_months)} —{' '}
        {inspection.template_name} again?
      </h2></div>

      <p className="modal__text">
        The cancellation stays on the record. This schedules the month again as a new
        inspection, with the template version published today.
      </p>

      {inspection.cancellation_reason ? (
        <p className="note">Cancelled: {inspection.cancellation_reason}</p>
      ) : null}

      <OpenPeriodForm
        period={{
          site_id: inspection.site_id,
          template_id: inspection.template_id,
          template_name: inspection.template_name,
          period_start: inspection.period_start,
          period_months: inspection.period_months,
        }}
        siteId={siteId}
        action="Schedule this period again"
        onOpened={() => dialogRef.current?.close()}
      />

      <div className="modal__actions"><button type="button" onClick={() => dialogRef.current?.close()}>Keep it cancelled</button></div>
    </dialog>
  );
}
