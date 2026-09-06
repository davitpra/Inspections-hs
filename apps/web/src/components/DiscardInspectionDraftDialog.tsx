import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { queryKeys } from '../api/query-keys';
import { discardDraft } from '../offline/drafts';
import { discardRefusalMessage } from '../presentation/drafts';
import { CalendarIcon, TrashIcon } from './icons';

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
 * Vive fuera de la fila, montado por la ruta: descartar invalida la lista de borradores y
 * el borrador de esa asignación, así que el progreso que se lee al lado
 * —`AssignmentChecklist`— no queda mostrando lo que ya no existe.
 *
 * Está en `components/` y no en una ruta porque lo montan dos: la página de la asignación
 * y `/outbox`, que es la única puerta cuando la asignación ya no vuelve del servidor.
 *
 * Se llama `Inspection` y no solo `Draft` porque hay OTRO diálogo de descartar un borrador
 * —`TemplatesRoute/DiscardDraftDialog`— y aquél descarta un borrador de PLANTILLA en la
 * consola del coordinador. Son la misma palabra sobre dos cosas sin nada en común, y este
 * vive en `components/`, donde el nombre se lee sin la carpeta que lo desambigüe.
 */
export function DiscardInspectionDraftDialog({
  clientSubmissionId,
  scheduledInspectionId,
  accountId,
  startedOn,
  onClose,
}: {
  clientSubmissionId: string;
  /** La asignación a la que pertenece: es la clave con la que se lee su progreso. */
  scheduledInspectionId: string;
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
      void queryClient.invalidateQueries({
        queryKey: queryKeys.draft(scheduledInspectionId),
      });
      // `outbox` NO cuelga de `drafts`, y desde que `/outbox` lista borradores sin firmar
      // es una de las pantallas que muestra lo que esto acaba de borrar. Sin esta línea la
      // fila descartada se queda dibujada sin un solo error en consola, que es exactamente
      // el fallo que `query-keys.ts` existe para evitar.
      void queryClient.invalidateQueries({ queryKey: queryKeys.outbox() });

      dialogRef.current?.close();
    },
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal discard-draft-dialog discard-draft-dialog--permanent"
      aria-labelledby="discard-inspection-draft-title"
      aria-describedby="discard-inspection-draft-description"
      onClose={onClose}
    >
      <div className="modal__head">
        <span className="modal__icon discard-draft-dialog__icon">
          <TrashIcon size={20} />
        </span>
        <div>
          <span className="discard-draft-dialog__eyebrow">Permanent deletion</span>
          <h2 id="discard-inspection-draft-title">Discard this draft?</h2>
        </div>
      </div>

      <div className="inspection-discard-dialog__date">
        <CalendarIcon size={18} />
        <span>Inspection started</span>
        <strong>{startedOn}</strong>
      </div>

      <div
        id="discard-inspection-draft-description"
        className="modal__text discard-draft-dialog__text inspection-discard-dialog__loss"
      >
        <strong>Everything saved in this draft will be deleted:</strong>
        <ul>
          <li>Answers</li>
          <li>Findings</li>
          <li>Photos</li>
        </ul>
        <p>Nothing was ever sent, so there is no copy to bring back.</p>
      </div>

      {discard.isError ? (
        <p className="notice notice--warn" role="alert">
          {discardRefusalMessage(discard.error)}
        </p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--danger"
          onClick={() => discard.mutate()}
          disabled={discard.isPending}
        >
          {discard.isPending ? 'Discarding…' : 'Discard the draft'}
        </button>

        <button
          type="button"
          className="discard-draft-dialog__cancel"
          onClick={() => dialogRef.current?.close()}
          disabled={discard.isPending}
        >
          Keep the draft
        </button>
      </div>
    </dialog>
  );
}
