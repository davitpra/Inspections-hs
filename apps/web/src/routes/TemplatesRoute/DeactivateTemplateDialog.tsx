import type { PublishedTemplateSummary } from '@hs/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { deactivateTemplate } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { CrossIcon } from '../../components/icons';

/**
 * Confirmar el retiro de una plantilla publicada.
 *
 * **Confirma, y por eso existe.** Retirar cambia lo que la organización puede programar mañana;
 * reactivar no pregunta nada porque devuelve una opción, no la quita.
 *
 * **Modal, y colgado de la sección y no de la fila.** Antes era un panel posicionado en absoluto
 * dentro del `<td>` de acciones: en una tabla ancha la confirmación se salía de la pantalla.
 * `showModal()` la centra sobre el scrim, y vive fuera de la tabla porque al aplicarse la
 * invalidación redibuja la fila que lo abrió.
 *
 * Las dos claves al invalidar, por lo mismo que explica `PublishedRow`: la consola cambia porque
 * la fila cambia de estado, y `templates()` es el listado de lo programable.
 */
export function DeactivateTemplateDialog({
  template,
  onClose,
}: {
  template: PublishedTemplateSummary;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.showModal();
  }, []);

  const deactivate = useMutation({
    mutationFn: () => deactivateTemplate(template.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.publishedTemplates() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
      ]);

      dialogRef.current?.close();
    },
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label="Deactivate template"
      onClose={() => { onClose(); returnFocusRef.current?.focus(); }}
    >
      <div className="modal__head">
        <span className="modal__icon"><CrossIcon size={20} /></span>
        <h2>Deactivate {template.name}?</h2>
      </div>

      <p className="modal__text">
        It stops being offered when scheduling inspections. Requirements and inspections
        already created with it stay exactly as they are.
      </p>

      {deactivate.isError ? (
        <p className="notice notice--warn" role="alert">{deactivate.error.message}</p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--danger"
          disabled={deactivate.isPending}
          onClick={() => deactivate.mutate()}
        >
          {deactivate.isPending ? 'Deactivating…' : 'Deactivate template'}
        </button>
        <button type="button" onClick={() => dialogRef.current?.close()}>Keep active</button>
      </div>
    </dialog>
  );
}
