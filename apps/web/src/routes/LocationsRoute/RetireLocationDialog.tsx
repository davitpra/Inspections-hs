import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { OrganizationLocation } from "@hs/contracts";

import { deactivateOrganizationLocation } from "../../api/catalog";
import { queryKeys } from "../../api/query-keys";

export function RetireLocationDialog({
  location,
  onClose,
}: {
  location: OrganizationLocation;
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    dialogRef.current?.showModal();
  }, []);

  const retire = useMutation({
    mutationFn: () => deactivateOrganizationLocation(location.id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.organizationLocations(),
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.catalogLocations(),
      });
      dialogRef.current?.close();
    },
  });

  return (
    <dialog
      ref={dialogRef}
      className="modal"
      aria-label="Retire location"
      onClose={() => {
        onClose();
        returnFocusRef.current?.focus();
      }}
    >
      <div className="modal__head">
        <h2>Retire {location.name}?</h2>
      </div>

      <p className="modal__text">
        Template sections that name this location will resolve to no location
        for future findings. Findings already registered keep pointing to their
        physical location and continue resolving in history.
      </p>

      {retire.isError ? (
        <p className="notice notice--warn" role="alert">
          {(retire.error as Error).message}
        </p>
      ) : null}

      <div className="modal__actions">
        <button
          type="button"
          className="button--danger"
          onClick={() => retire.mutate()}
          disabled={retire.isPending}
        >
          {retire.isPending ? "Retiring…" : "Retire this location"}
        </button>

        <button type="button" onClick={() => dialogRef.current?.close()}>
          Keep it
        </button>
      </div>
    </dialog>
  );
}
