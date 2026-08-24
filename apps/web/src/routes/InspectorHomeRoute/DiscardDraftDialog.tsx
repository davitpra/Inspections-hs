import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { queryKeys } from '../../api/query-keys';
import { discardDraft } from '../../offline/drafts';
import { discardRefusalMessage } from './presentation';

/**
 * Confirmar antes de descartar un borrador.
 *
 * **Por qué hay confirmación.** Es lo único de esta aplicación que destruye trabajo del
 * inspector sin que nadie más se entere: no hay copia en el servidor —el borrador nunca
 * salió del dispositivo (ADR-001)— y no hay papelera. Un botón que borrara de una, en una
 * fila de una lista, a un dedo de distancia del link que abre la inspección, perdería un
 * recorrido de tres horas por un error de puntería.
 *
 * **La confirmación dice QUÉ SE PIERDE**, no «¿estás seguro?»: las respuestas, los
 * hallazgos y las fotos de ese recorrido, y que no se recuperan. El inspector no puede
 * decidir sobre una pregunta que no le informa nada.
 *
 * Vive fuera de la fila, montado por `index.tsx`: descartar invalida la lista de
 * borradores y la fila que abrió el diálogo deja de existir en el próximo render.
 */
export function DiscardDraftDialog({
  clientSubmissionId,
  accountId,
  startedOn,
  onClose,
}: {
  clientSubmissionId: string;
  accountId: string;
  /** La fecha en que se empezó, `YYYY-MM-DD`: lo único que distingue un borrador de otro. */
  startedOn: string;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const discard = useMutation({
    mutationFn: () => discardDraft(clientSubmissionId, accountId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.drafts() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.draft(clientSubmissionId) });

      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <h2>Discard this draft?</h2>

      <p>
        The answers, findings and photos of the inspection started on {startedOn} are deleted
        from this device. Nothing of this draft was ever sent, so there is no copy to bring
        back.
      </p>

      <button
        type="button"
        className="button--danger"
        onClick={() => discard.mutate()}
        disabled={discard.isPending}
      >
        {discard.isPending ? 'Discarding…' : 'Discard the draft'}
      </button>

      {/*
       * El error se muestra y el diálogo NO se cierra: los tres motivos por los que la
       * base se niega —otra cuenta, ya firmada, ya en la cola— significan que el
       * borrador sigue ahí, y cerrar dejaría al inspector creyendo que se borró.
       */}
      {discard.isError ? (
        <p className="notice">{discardRefusalMessage(discard.error)}</p>
      ) : null}

      <button type="button" onClick={() => dialogRef.current?.close()}>
        Keep the draft
      </button>
    </dialog>
  );
}
