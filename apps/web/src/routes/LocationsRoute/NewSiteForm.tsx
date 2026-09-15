import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId, useState } from 'react';

import { createSite } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';
import { CloseIcon } from '../../components/icons';
import { useAppSession } from '../../app/session-context';
import { canCreate, suggestCode } from './presentation';

/**
 * Alta de una planta desde la consola. No lleva `SitePicker`: no hay una planta que elegir
 * cuando la operación está creando justamente la planta.
 *
 * **EL CÓDIGO SE DERIVA DEL NOMBRE Y NO SE PIDE**, igual que en `NewLocationForm`. Lo que
 * el coordinador da de alta es una planta, no un identificador; el `code` es consecuencia
 * del alta. Sigue existiendo y sigue importando —es la columna `site_code` del CSV del
 * roster (`apps/api/src/roster/parse-roster-csv.ts`) y lo que aparece en los reportes—,
 * pero se lee después en la hoja «Manage sites», que es donde el code de cada planta está
 * a la vista.
 *
 * Acá no hay campo de escape, a diferencia del alta de ubicación: la corrección de un code
 * ya usado es corregir el nombre, porque uno sale del otro. Un nombre que no produce
 * ningún code deja el botón deshabilitado (`canCreate`), que es lo mismo que hace el
 * `CHECK` de la migración 0004 pero antes de viajar.
 */
export function NewSiteForm({ onClose }: { onClose: () => void }): React.JSX.Element {
  const queryClient = useQueryClient();
  const { reload } = useAppSession();
  const controlId = useId();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const code = suggestCode(name);

  const create = useMutation({
    mutationFn: () => createSite({ code, name: name.trim() }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sites() });
      await reload();

      // El alta terminó: la columna nueva ya está en la tabla y el panel no tiene más que hacer.
      onClose();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <div className="card">
      <div className="card__head">
        <h3>Add a site</h3>
        <button
          type="button"
          className="card__close"
          aria-label="Close add a site"
          onClick={onClose}
        >
          <CloseIcon size={20} />
        </button>
      </div>

      <p className="note">
        This site will be reachable only by the account that registers it; grant access to other
        accounts from the account console.
      </p>

      <div className="filters">
        <label htmlFor={`${controlId}-name`}>Name</label>
        <input
          id={`${controlId}-name`}
          type="text"
          value={name}
          placeholder="North plant"
          onChange={(event) => setName(event.target.value)}
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
