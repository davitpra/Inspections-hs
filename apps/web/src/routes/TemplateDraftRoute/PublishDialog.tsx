import { useEffect, useRef } from 'react';

import { CheckIcon } from '../../components/icons';

/** Confirmación del punto de no retorno de publicar un borrador. */
export function PublishDialog({
  draftName,
  publishing,
  error,
  onClose,
  onConfirm,
}: {
  draftName: string;
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
        This creates version 1. A published version cannot be edited, and this draft will close.
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
