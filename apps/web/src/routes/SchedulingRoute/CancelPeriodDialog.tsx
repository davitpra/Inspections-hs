import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useRef, useState } from 'react';
import type { ScheduledInspection } from '@hs/contracts';

import { cancelScheduledInspection } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { monthName } from './presentation';

/**
 * Cancelar un período abierto: primero la decisión, después el motivo.
 *
 * **Confirma, y por eso existe.** Cancelar no se deshace, y el botón que lo dispara cuelga
 * de una fila entre doce meses; escribir el motivo en la fila —como se hacía antes— ponía
 * el textarea de una acción excepcional en cada período del calendario y dejaba la
 * justificación antes de la decisión, que es al revés de como se piensa.
 *
 * **Vive fuera de `PeriodControls`.** Al cancelar con éxito la invalidación redibuja la
 * fila con `cancelled_at` no nulo y los controles dejan de montarse; el diálogo tiene que
 * colgar de un nodo que sobreviva a la mutación, y ese nodo es `PeriodRow`.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA, igual que al asignar: si el servidor rechaza, el período
 * tiene que seguir viéndose abierto y el error tiene que leerse acá adentro.
 */
export function CancelPeriodDialog({
  inspection,
  onClose,
}: {
  inspection: ScheduledInspection;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const controlId = useId();
  const [reason, setReason] = useState('');

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const cancel = useMutation({
    mutationFn: () => cancelScheduledInspection(inspection.id, reason),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.scheduledInspections() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.pendingInspections() });

      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <h2>
        Cancel {monthName(inspection.period_start)} — {inspection.template_name}?
      </h2>

      <p>Cancelling cannot be undone. The period is scheduled again instead.</p>

      {/*
        `htmlFor`/`id` y no un `<label>` que envuelve al control, igual que en
        `PeriodControls`.
      */}
      <label htmlFor={`${controlId}-reason`}>Cancel with a reason</label>
      <textarea
        id={`${controlId}-reason`}
        value={reason}
        maxLength={500}
        onChange={(event) => setReason(event.target.value)}
        placeholder="Why this period will not be inspected"
      />

      <button
        type="button"
        onClick={() => cancel.mutate()}
        disabled={reason.trim() === '' || cancel.isPending}
      >
        {cancel.isPending ? 'Cancelling…' : 'Confirm cancellation'}
      </button>

      {cancel.isError ? <p className="notice">{(cancel.error as Error).message}</p> : null}

      <button type="button" onClick={() => dialogRef.current?.close()}>
        Keep this period
      </button>
    </dialog>
  );
}
