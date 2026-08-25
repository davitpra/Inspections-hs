import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { reviseTemplate } from '../../api/templates';
import { DocumentIcon } from '../../components/icons';

/**
 * La única cosa que se puede hacer sobre una versión congelada: corregirla.
 *
 * El botón dice "Edit template" porque es lo que el coordinador viene a hacer, pero lo que se
 * muestra en pantalla no se vuelve editable: la nota de abajo lo dice en una línea —la versión es
 * de lectura, y editar arranca una VERSIÓN NUEVA, no una corrección de esta—. Lo que abre de
 * inmediato es un borrador sembrado con este documento; la nota nombra el destino y no el paso
 * intermedio. Y vive aquí y no en el encabezado a propósito: es la consecuencia de pulsar, no una
 * propiedad de la pantalla.
 *
 * **No pregunta antes.** Sembrar un borrador no es un punto de no retorno: se descarta como
 * cualquier otro, y no escribe una sola fila en el modelo publicado. El diálogo de confirmación
 * está donde corresponde, al publicar.
 *
 * **Y no distingue "creado" de "ya existía".** El servidor devuelve la revisión viva si la hay
 * (es idempotente), y para el coordinador las dos cosas son la misma: llegar a la corrección.
 */
export function ReviseAction({ templateId }: { templateId: string }): React.JSX.Element {
  const navigate = useNavigate();
  const revise = useMutation({
    mutationFn: () => reviseTemplate(templateId),
    onSuccess: (draft) => {
      void navigate({ to: '/templates/drafts/$id', params: { id: draft.id } });
    },
  });

  return (
    <div className="published-template__revise">
      <button
        type="button"
        className="button--primary"
        onClick={() => revise.mutate()}
        disabled={revise.isPending}
      >
        <DocumentIcon size={16} /> {revise.isPending ? 'Opening…' : 'Edit template'}
      </button>

      <p className="published-template__revise-note">Read-only · editing starts a new version</p>

      {revise.isError ? (
        <p className="notice">
          This template could not be opened for revision. Nothing was changed.
        </p>
      ) : null}
    </div>
  );
}
