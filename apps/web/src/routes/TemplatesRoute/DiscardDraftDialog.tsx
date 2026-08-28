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
 * y ese nodo es la ruta. Es el mismo motivo que documenta `RequirementConfirmDialog`.
 *
 * Como el borrador se puede recuperar, el diálogo usa el color de marca en vez del color de
 * peligro. El botón que descarta queda como acción primaria y el que no hace nada, sin chrome:
 * las dos salidas comparten renglón y tienen que distinguirse sin leerlas.
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
    <dialog
      ref={dialogRef}
      className="modal discard-draft-dialog discard-draft-dialog--recoverable"
      aria-labelledby="discard-draft-title"
      aria-describedby="discard-draft-description"
      onClose={onClose}
    >
      <div className="modal__head">
        <span className="modal__icon discard-draft-dialog__icon" aria-hidden="true">
          <TrashIcon size={20} />
        </span>
        <div>
          <span className="discard-draft-dialog__eyebrow">Draft removal</span>
          <h2 id="discard-draft-title">Discard “{draftName}”?</h2>
        </div>
      </div>

      <p id="discard-draft-description" className="modal__text discard-draft-dialog__text">
        It disappears from this list and its key becomes available again. Nothing is deleted,
        so it can be recovered by whoever maintains the database.
      </p>

      {discard.isError ? (
        <p className="notice notice--warn" role="alert">{discard.error.message}</p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--primary"
          onClick={() => discard.mutate()}
          disabled={discard.isPending}
        >
          {discard.isPending ? 'Discarding…' : 'Discard draft'}
        </button>

        <button
          type="button"
          className="discard-draft-dialog__cancel"
          onClick={() => dialogRef.current?.close()}
          disabled={discard.isPending}
        >
          Keep it
        </button>
      </div>
    </dialog>
  );
}
