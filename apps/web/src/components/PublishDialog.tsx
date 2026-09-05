import { useEffect, useRef } from 'react';

import { CheckIcon } from './icons';

/**
 * Confirmación del punto de no retorno de publicar un borrador.
 *
 * **Nombra el número de versión que va a crear**, y no dice siempre «version 1»: quien confirma
 * un punto de no retorno tiene derecho a saber qué registro está por escribir. El número lo
 * calcula el servidor al leer el borrador (`next_version`); es una lectura y no una reserva,
 * pero es la mejor respuesta que hay antes de publicar.
 *
 * **Vive acá y no en una ruta porque lo montan dos**: el builder, desde su botón «Publish»,
 * y el listado de borradores, desde el «⋮» de la fila. El texto que describe lo que no se
 * deshace tiene que ser UNO SOLO — dos copias se separan la primera vez que alguien corrige
 * una, y entonces la misma acción promete dos cosas distintas según desde dónde se la pida.
 *
 * No trae la mutación: quién publica y qué invalida después depende de dónde se lo monte —el
 * builder navega a `/templates`, el listado se queda y redibuja las dos tarjetas—, así que
 * eso es del que lo abre.
 */
export function PublishDialog({
  draftName,
  nextVersion,
  revising,
  publishing,
  error,
  onClose,
  onConfirm,
}: {
  draftName: string;
  nextVersion: number;
  /** Corrige una plantilla publicada: la versión anterior sigue donde está. */
  revising: boolean;
  publishing: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <div className="modal__head">
        <span className="modal__icon">
          <CheckIcon size={20} />
        </span>
        <h2>Publish “{draftName}”?</h2>
      </div>

      <p className="modal__text">
        This creates version {nextVersion}.{' '}
        {revising
          ? 'The version it replaces stays readable and keeps every inspection already bound to it.'
          : 'A published version cannot be edited, and this draft will close.'}{' '}
        There is no undo.
      </p>

      <div className="modal__actions">
        <button type="button" className="button--primary" onClick={onConfirm} disabled={publishing}>
          {publishing ? 'Publishing…' : 'Publish template'}
        </button>

        <button type="button" onClick={() => dialogRef.current?.close()} disabled={publishing}>
          Keep editing
        </button>
      </div>

      {error ? <p className="notice">{error}</p> : null}
    </dialog>
  );
}
