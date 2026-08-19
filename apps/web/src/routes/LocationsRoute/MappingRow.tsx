import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useId } from 'react';
import type { Location, OrganizationLocation } from '@hs/contracts';

import { mapLocation } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';
import { assignedLocation, availableLocations } from './presentation';

/**
 * Una ubicación compartida y qué lugar de ESTA planta la representa.
 *
 * **MOVER UNA COMPARTIDA SON DOS ESCRITURAS, Y EN ESTE ORDEN.** El mapeo vive en la fila
 * física (`location.organization_location_id`), no en la compartida, y la migración 0018
 * tiene `UNIQUE (site_id, organization_location_id)`. Así que reasignar de "Muelle A" a
 * "Muelle B" no es un update: hay que soltar A y recién después tomar B. Al revés, el
 * único salta y el coordinador ve un error de Postgres al hacer lo único que la pantalla le
 * ofrece.
 *
 * Cada fila lleva su propio estado. La primera versión deshabilitaba los 22 selects con un
 * `update.isPending` compartido: tocar uno congelaba la pantalla entera.
 */
export function MappingRow({
  shared,
  locations,
  siteId,
}: {
  shared: OrganizationLocation;
  locations: readonly Location[];
  siteId: string;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const controlId = useId();

  const current = assignedLocation(shared, locations, siteId);
  const options = availableLocations(shared, locations, siteId);

  const remap = useMutation({
    mutationFn: async (nextLocationId: string) => {
      // Soltar primero. Si `nextLocationId` es vacío, soltar es todo lo que hay que hacer.
      if (current && current.id !== nextLocationId) {
        await mapLocation(current.id, null);
      }

      if (nextLocationId !== '') {
        await mapLocation(nextLocationId, shared.id);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogLocations() });
    },
  });

  return (
    <li className="list__row">
      <div className="mapping__label">
        <label htmlFor={controlId}>{shared.name}</label>
        <p className="note">{shared.code}</p>
      </div>

      <select
        id={controlId}
        value={current?.id ?? ''}
        disabled={remap.isPending}
        onChange={(event) => remap.mutate(event.target.value)}
      >
        <option value="">Not mapped in this plant</option>
        {options.map((location) => (
          <option key={location.id} value={location.id}>
            {location.name}
          </option>
        ))}
      </select>

      {/*
        El estado va en la fila y no arriba de la página. Un aviso a 22 filas de distancia
        no dice cuál de todas falló, que es lo único que hace falta saber.
      */}
      <span className="mapping__state">
        {remap.isPending ? 'Saving…' : null}
        {!remap.isPending && remap.isError ? (
          <span className="notice">{(remap.error as Error).message}</span>
        ) : null}
        {!remap.isPending && !remap.isError && current ? (
          <span className="status-pill status-pill--ready">Mapped</span>
        ) : null}
        {!remap.isPending && !remap.isError && !current ? (
          <span className="status-pill status-pill--not-ready">Missing here</span>
        ) : null}
      </span>
    </li>
  );
}
