import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { InspectionSchedule } from '@hs/contracts';

import { updateSchedule } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { CrossIcon } from '../../components/icons';

/**
 * Confirmar lo que le saca un requisito a la tabla: desactivarlo o archivarlo.
 *
 * **Un componente para las dos preguntas.** Lo que cambia entre desactivar y archivar es la
 * redacción y el tono del botón; todo lo demás —el foco, Escape, el error del servidor, las dos
 * salidas en un renglón— es idéntico, y partirlo en dos archivos dejaría dos confirmaciones que
 * hay que mantener iguales (mismo criterio que `RosterRoute/RemoveAccessDialog`).
 *
 * **Modal, y colgado de la sección y no de la fila.** Antes esto era un panel posicionado en
 * absoluto dentro del `<td>` de acciones: en una tabla ancha la confirmación se cortaba contra el
 * borde. Un `<dialog>` con `showModal()` lo centra sobre el scrim, y vive fuera de la tabla: al
 * aplicar el cambio la invalidación redibuja la fila, y el diálogo tiene que colgar de un nodo
 * que sobreviva a la mutación.
 *
 * SIN ACTUALIZACIÓN OPTIMISTA: si el servidor rechaza, el requisito sigue viéndose como está y el
 * error se lee acá adentro.
 */
export function RequirementConfirmDialog({
  rule,
  kind,
  onClose,
}: {
  rule: InspectionSchedule;
  kind: 'deactivate' | 'archive';
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const deactivating = kind === 'deactivate';

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const update = useMutation({
    mutationFn: () => updateSchedule(rule.id, deactivating ? { deactivated: true } : { archived: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inspectionSchedules() });

      dialogRef.current?.close();
    },
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label={deactivating ? 'Deactivate requirement' : 'Archive requirement'}
      onClose={() => { onClose(); returnFocusRef.current?.focus(); }}
    >
      <div className="modal__head">
        {/* El ícono dice de qué clase es la decisión antes de leerla; archivar no es peligro. */}
        {deactivating ? <span className="modal__icon"><CrossIcon size={20} /></span> : null}
        <h2>{deactivating ? `Deactivate ${rule.template_name}?` : `Archive ${rule.template_name}?`}</h2>
      </div>

      <p className="modal__text">
        {deactivating
          ? 'No future period will be opened from this requirement. Periods already opened remain unchanged.'
          : 'This removes the requirement from the default table. Its past obligations and scheduled inspections remain unchanged.'}
      </p>

      {update.isError ? <p className="notice notice--warn" role="alert">{(update.error as Error).message}</p> : null}

      <div className="modal__actions">
        <button
          type="button"
          className={deactivating ? 'button--danger' : 'button--primary'}
          disabled={update.isPending}
          onClick={() => update.mutate()}
        >
          {update.isPending
            ? deactivating ? 'Deactivating…' : 'Archiving…'
            : deactivating ? 'Deactivate requirement' : 'Archive requirement'}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>
          {deactivating ? 'Keep active' : 'Keep requirement'}
        </button>
      </div>
    </dialog>
  );
}
