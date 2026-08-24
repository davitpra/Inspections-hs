import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';

import { reviseTemplate } from '../../api/templates';
import { DocumentIcon } from '../../components/icons';

/**
 * La única cosa que se puede hacer sobre una versión congelada: corregirla.
 *
 * El encabezado dice desde siempre que para corregir una plantilla hay que publicar una
 * versión nueva, y hasta ahora no había ningún botón que lo hiciera. Este es ese botón, y no
 * contradice el resto de la pantalla: no vuelve editable la versión —lo que se muestra sigue
 * congelado—, abre un BORRADOR sembrado con este documento.
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
        <DocumentIcon size={16} /> {revise.isPending ? 'Opening…' : 'Revise this template'}
      </button>

      {revise.isError ? (
        <p className="notice">
          This template could not be opened for revision. Nothing was changed.
        </p>
      ) : null}
    </div>
  );
}
