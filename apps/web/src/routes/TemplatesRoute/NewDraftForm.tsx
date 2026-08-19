import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useId, useState } from 'react';

import { createTemplateDraft } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { canCreate } from './presentation';

/**
 * Empezar una plantilla: cómo se va a llamar, y nada más.
 *
 * **UN SOLO CAMPO, Y ES LA DECISIÓN DE FONDO DE ESTA PANTALLA.** La plantilla también lleva
 * una `key` —un identificador técnico que usan los seeds y que va a nombrarla cuando se
 * publique— pero no se la pedimos: la deriva el servidor del nombre. Pedírsela al
 * coordinador era pedirle una decisión que no tiene forma de tomar bien, y abría la puerta a
 * dos borradores con el mismo nombre y claves distintas, que en el listado son dos renglones
 * idénticos.
 *
 * Con el nombre como identidad —único, y forzado por un índice— la clave se deriva sin
 * desempatar y el rechazo por colisión habla de lo único que el autor puede cambiar.
 *
 * **Sin actualización optimista.** Si el servidor rechaza el nombre —lo tiene otro borrador,
 * lo tiene una plantilla publicada, o no deja derivar ninguna clave— el error se lee acá y
 * el formulario conserva lo escrito. Es el rechazo más probable de toda la pantalla.
 */
export function NewDraftForm(): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const controlId = useId();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createTemplateDraft({ name: name.trim() }),
    onSuccess: (draft) => {
      setName('');
      setError(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.templateDrafts() });

      // Crear un borrador es querer escribirlo. Dejarlo en la lista obligaría a buscarlo.
      void navigate({ to: '/templates/drafts/$id', params: { id: draft.id } });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <div className="card">
      <div className="card__head">
        <h3>Start a template</h3>
      </div>

      <div className="filters">
        <label htmlFor={`${controlId}-name`}>Name</label>
        <input
          id={`${controlId}-name`}
          type="text"
          value={name}
          placeholder="Monthly electrical inspection"
          onChange={(event) => setName(event.target.value)}
        />
        <button
          type="button"
          className="button--primary"
          onClick={() => create.mutate()}
          disabled={!canCreate(name) || create.isPending}
        >
          {create.isPending ? 'Creating…' : 'Create draft'}
        </button>
      </div>

      <p className="note">
        The name identifies the template, so no two can share one. You can rename it later.
      </p>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
