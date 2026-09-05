import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';

import { createScheduledInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import type { UnopenedPeriod } from '../../presentation/scheduling';

/**
 * Confirmar la apertura de un período.
 *
 * **Abrir congela una versión**, y eso es lo único que el diálogo existe para decir antes
 * de que se toque el botón: el período va a quedar atado a la plantilla publicada de HOY
 * aunque mañana se publique otra. Sin versión publicada no hay nada que congelar y no se
 * puede confirmar.
 *
 * La visibilidad anticipada vive acá y no en la fila: es una decisión sobre ESTA
 * apertura, no una columna de la tabla, y su etiqueta no entra en una celda sin partirse
 * en cuatro renglones.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA: si el servidor rechaza, el error se lee acá adentro y la
 * tabla sigue mostrando el período sin abrir.
 */
export function OpenPeriodDialog({
  period,
  label,
  publishedVersion,
  onClose,
}: {
  period: UnopenedPeriod;
  label: string;
  publishedVersion: number | null;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const id = useId();
  const [visibleEarly, setVisibleEarly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const open = useMutation({
    mutationFn: () => createScheduledInspection({
      site_id: period.site_id,
      template_id: period.template_id,
      period_start: period.period_start,
      visible_early: visibleEarly,
    }),
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });

      dialogRef.current?.close();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label={`Open ${label}`}
      onClose={() => { onClose(); returnFocusRef.current?.focus(); }}
    >
      <div className="modal__head"><h2>Open {label}?</h2></div>

      <p className="modal__text">
        {publishedVersion === null
          ? 'The published template version could not be loaded, so there is nothing to freeze. This period cannot be opened right now.'
          : `Version ${publishedVersion} will be frozen when this period opens. A later revision does not change it.`}
      </p>

      <div className="modal__form modal__form--spaced">
        <label className="modal__check" htmlFor={`${id}-early`}>
          <input
            id={`${id}-early`}
            type="checkbox"
            checked={visibleEarly}
            disabled={open.isPending || publishedVersion === null}
            onChange={(event) => setVisibleEarly(event.target.checked)}
          />
          Make visible to the inspector before the period starts
        </label>
      </div>

      {error ? <p className="notice notice--warn" role="alert">{error}</p> : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--primary"
          disabled={open.isPending || publishedVersion === null}
          onClick={() => open.mutate()}
        >
          {open.isPending ? 'Opening…' : 'Open period'}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>Cancel</button>
      </div>
    </dialog>
  );
}
