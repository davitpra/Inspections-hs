import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { discardTemplateDraft } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';

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
      <h2>Discard “{draftName}”?</h2>

      <p>
        It disappears from this list and its key becomes available again. Nothing is deleted,
        so it can be recovered by whoever maintains the database.
      </p>

      <button
        type="button"
        className="button--danger"
        onClick={() => discard.mutate()}
        disabled={discard.isPending}
      >
        {discard.isPending ? 'Discarding…' : 'Discard draft'}
      </button>

      {discard.isError ? <p className="notice">{(discard.error as Error).message}</p> : null}

      <button type="button" onClick={() => dialogRef.current?.close()}>
        Keep it
      </button>
    </dialog>
  );
}
