import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { OrganizationLocation } from '@hs/contracts';

import { deactivateOrganizationLocation } from '../../api/catalog';
import { queryKeys } from '../../api/query-keys';

/**
 * La retirada cambia lo que resolverán las secciones futuras, por eso necesita una confirmación
 * explícita. Vive fuera de `LocationRow`: la mutación invalida la fila que la abrió.
 */
export function RetireLocationDialog({
  location,
  onClose,
}: {
  location: OrganizationLocation;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const retire = useMutation({
    mutationFn: () => deactivateOrganizationLocation(location.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizationLocations() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.catalogLocations() });
      dialogRef.current?.close();
    },
  });

  return (
    <dialog ref={dialogRef} className="modal" onClose={onClose}>
      <h2>Retire {location.name}?</h2>

      <p>
        Template sections that name this location will resolve to no location for future findings.
        Findings already registered keep pointing to their physical location and continue
        resolving in history.
      </p>

      <button type="button" onClick={() => retire.mutate()} disabled={retire.isPending}>
        {retire.isPending ? 'Retiring…' : 'Retire this location'}
      </button>

      {retire.isError ? <p className="notice">{(retire.error as Error).message}</p> : null}

      <button type="button" onClick={() => dialogRef.current?.close()}>
        Keep it
      </button>
    </dialog>
  );
}
