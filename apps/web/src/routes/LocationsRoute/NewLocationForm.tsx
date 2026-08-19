import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { createLocation, createOrganizationLocation } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';
import { canCreate, suggestCode } from './presentation';

/**
 * Dar de alta, en cualquiera de las dos poblaciones.
 *
 * UN SOLO COMPONENTE PARA LAS DOS porque el formulario es idéntico —nombre y código— y lo
 * único que cambia es a dónde va. Dos archivos casi iguales se separan al primer arreglo
 * que alguien haga en uno solo.
 *
 * **El código se propone y se muestra, no se genera a escondidas.** Es lo contrario de la
 * `key` de una plantilla, y a propósito: la cabecera de `contracts/catalog.ts` dice que el
 * código del catálogo es legible porque los seeds se escriben a mano y porque aparece en
 * los reportes. Se deja de proponer en cuanto el autor lo edita.
 *
 * Para una compartida el código pesa más que para una física: es lo que la sección de una
 * plantilla guarda, así que cambiarlo después rompería esa referencia.
 */
export function NewLocationForm({
  scope,
  siteId,
  siteName,
}: {
  scope: 'shared' | 'plant';
  siteId: string;
  siteName: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shared = scope === 'shared';

  const create = useMutation({
    mutationFn: () =>
      shared
        ? createOrganizationLocation({ code, name: name.trim() })
        : createLocation(siteId, { code, name: name.trim() }),
    onSuccess: () => {
      setName('');
      setCode('');
      setCodeTouched(false);
      setError(null);

      // Un alta compartida cambia el listado; una física cambia las opciones de cada fila.
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizationLocations() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogLocations() });
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const onNameChange = (value: string): void => {
    setName(value);
    if (!codeTouched) setCode(suggestCode(value));
  };

  return (
    <div className="card">
      <div className="card__head">
        <h3>{shared ? 'Add a shared location' : `Add a location to ${siteName}`}</h3>
      </div>

      <p className="note">
        {shared
          ? 'A place every plant has. Template sections are written against these, and each plant then points one of its own locations at it.'
          : 'A real place in this plant. It becomes selectable above, and findings recorded here will name it.'}
      </p>

      <div className="filters">
        <label htmlFor={`${controlId}-name`}>Name</label>
        <input
          id={`${controlId}-name`}
          type="text"
          value={name}
          placeholder={shared ? 'Loading dock' : 'Loading dock — east'}
          onChange={(event) => onNameChange(event.target.value)}
        />
      </div>

      <div className="filters">
        <label htmlFor={`${controlId}-code`}>Code</label>
        <input
          id={`${controlId}-code`}
          type="text"
          value={code}
          placeholder="loading-dock"
          onChange={(event) => {
            setCodeTouched(true);
            setCode(event.target.value);
          }}
        />
        <button
          type="button"
          className="button--primary"
          onClick={() => create.mutate()}
          disabled={!canCreate(name, code) || create.isPending}
        >
          {create.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>

      {error ? <p className="notice">{error}</p> : null}
    </div>
  );
}
