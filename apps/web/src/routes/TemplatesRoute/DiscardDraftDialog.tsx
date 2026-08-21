import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { discardTemplateDraft } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { TrashIcon } from '../../components/icons';

/**
 * Descartar un borrador: primero la decisión.
 *
 * **Confirma, y por eso existe.** Descartar saca del listado el único lugar donde vive un
 * documento a medio escribir; que un click de más lo haga desaparecer sin preguntar sería
 * perder trabajo que nadie más tiene.
 *
 * **Lo que NO hace es borrar.** La fila queda con `discarded_at` —el motor prohíbe el DELETE
 * a todos los roles— y el texto lo dice: el autor merece saber que puede pedir que se lo
 * recuperen, aunque esta pantalla no lo ofrezca.
 *
 * **Vive fuera de la fila que lo abre.** Al descartar con éxito, la invalidación redibuja el
 * listado sin esa fila; el diálogo tiene que colgar de un nodo que sobreviva a la mutación,
 * y ese nodo es la ruta. Es el mismo motivo que documenta `CancelPeriodDialog`.
 *
 * EL ÍCONO Y EL COLOR DE PELIGRO ESTÁN EN EL TÍTULO, no en el botón solo: de qué clase es
 * la decisión se ve antes de leer la pregunta, que es cuando todavía sirve. El botón que
 * descarta queda en `--danger` y el que no hace nada, sin chrome de peligro: las dos salidas
 * comparten renglón y tienen que distinguirse sin leerlas.
 */
export function DiscardDraftDialog({
  draftId,
  draftName,
  onClose,
}: {
  draftId: string;
  draftName: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const discard = useMutation({
    mutationFn: () => discardTemplateDraft(draftId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.templateDrafts() });
      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal__head">
        <span className="modal__icon">
          <TrashIcon size={20} />
        </span>
        <h2>Discard “{draftName}”?</h2>
      </div>

      <p className="modal__text">
        It disappears from this list and its key becomes available again. Nothing is deleted,
        so it can be recovered by whoever maintains the database.
      </p>

      <div className="modal__actions">
        <button
          type="button"
          className="button--danger"
          onClick={() => discard.mutate()}
          disabled={discard.isPending}
        >
          {discard.isPending ? 'Discarding…' : 'Discard draft'}
        </button>

        <button type="button" onClick={() => dialogRef.current?.close()}>
          Keep it
        </button>
      </div>

      {discard.isError ? <p className="notice">{(discard.error as Error).message}</p> : null}
    </dialog>
  );
}
