import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Location, Site } from '@hs/contracts';
import { useState } from 'react';

import { deactivateSite, renameSite } from '../../api/catalog';
import { Sheet } from '../../app/Sheet';
import { queryKeys } from '../../api/query-keys';

/**
 * Gestión de la etiqueta y la baja lógica de las plantas. El code se muestra como
 * identidad, pero no se convierte en un control editable.
 */
export function ManageSitesSheet({
  sites,
  locations,
  onClose,
}: {
  sites: readonly Site[];
  locations: readonly Location[];
  onClose: () => void;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.sites() });
    await queryClient.invalidateQueries({ queryKey: queryKeys.catalogLocations() });
  };

  const rename = useMutation({
    mutationFn: ({ siteId, value }: { siteId: string; value: string }) => renameSite(siteId, value),
    onSuccess: async () => {
      setEditing(null);
      setError(null);
      await refresh();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  const remove = useMutation({
    mutationFn: (siteId: string) => deactivateSite(siteId),
    onSuccess: async () => {
      setConfirming(null);
      setError(null);
      await refresh();
    },
    onError: (caught: Error) => setError(caught.message),
  });

  return (
    <Sheet side="end" label="Manage sites" onClose={onClose}>
      <p className="note">
        Site codes are permanent. Removing a site keeps its history and unlinks its physical
        locations from the shared catalogue.
      </p>

      <div className="manage-sites__list">
        {sites.map((site) => {
          const physical = locations.filter((location) => location.site_id === site.id);
          const mapped = physical.filter((location) => location.organization_location_code !== null);
          const isEditing = editing === site.id;
          const isConfirming = confirming === site.id;

          return (
            <article className="manage-sites__item" key={site.id}>
              <div className="manage-sites__summary">
                <div>
                  <h3>{site.name}</h3>
                  <p className="manage-sites__code">{site.code}</p>
                </div>
                <span className={site.deactivated_at ? 'status-pill status-pill--cancelled' : 'status-pill'}>
                  {site.deactivated_at ? 'Removed' : 'Active'}
                </span>
              </div>

              <p className="manage-sites__coverage">
                {mapped.length} of {physical.length} physical locations mapped
              </p>

              {isEditing ? (
                <form
                  className="manage-sites__form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    rename.mutate({ siteId: site.id, value: name.trim() });
                  }}
                >
                  <label htmlFor={`site-name-${site.id}`}>Name</label>
                  <input
                    id={`site-name-${site.id}`}
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    autoFocus
                  />
                  <div className="manage-sites__actions">
                    <button type="submit" className="button--primary" disabled={!name.trim() || rename.isPending}>
                      {rename.isPending ? 'Saving…' : 'Save'}
                    </button>
                    <button type="button" onClick={() => setEditing(null)} disabled={rename.isPending}>
                      Cancel
                    </button>
                  </div>
                </form>
              ) : null}

              {!site.deactivated_at && !isEditing ? (
                <div className="manage-sites__actions">
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(site.id);
                      setName(site.name);
                      setError(null);
                    }}
                  >
                    Edit name
                  </button>
                  <button
                    type="button"
                    className="button--danger"
                    onClick={() => {
                      setConfirming(site.id);
                      setError(null);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}

              {isConfirming ? (
                <div className="manage-sites__confirm">
                  <p>Remove {site.name}? This cannot be undone.</p>
                  <div className="manage-sites__actions">
                    <button
                      type="button"
                      className="button--danger"
                      onClick={() => remove.mutate(site.id)}
                      disabled={remove.isPending}
                    >
                      {remove.isPending ? 'Removing…' : 'Remove site'}
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} disabled={remove.isPending}>
                      Keep site
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {error ? <p className="notice" role="alert">{error}</p> : null}
    </Sheet>
  );
}
