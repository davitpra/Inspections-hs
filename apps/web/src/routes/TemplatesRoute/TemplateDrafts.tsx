import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { listTemplateDrafts } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { GridIcon, InfoIcon } from '../../components/icons';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { DraftList } from './DraftList';
import { NewDraftForm } from './NewDraftForm';
import { sortDrafts } from './presentation';

export function TemplateDrafts(): React.JSX.Element {
  /**
   * El borrador que se está descartando, ACÁ y no en la fila que lo originó: descartar
   * invalida el listado y la fila deja de montarse. El diálogo sobrevive porque cuelga de
   * la consola. Ver `DiscardDraftDialog.tsx`.
   */
  const [discarding, setDiscarding] = useState<{ id: string; name: string } | null>(null);

  const drafts = useQuery({
    queryKey: queryKeys.templateDrafts(),
    queryFn: listTemplateDrafts,
    retry: false,
  });

  const visible = sortDrafts(drafts.data ?? []);

  return (
    <>
      <h1>Templates</h1>

      {/**
        Lo que esta pantalla NO hace, dicho arriba y no escondido en un botón deshabilitado:
        sin esta línea, el coordinador escribe una plantilla entera y recién al final
        descubre que no puede usarla.
      */}
      <p className="note">
        These are drafts. Publishing a template so it can be scheduled is not available yet —
        a draft is saved, reordered and reviewed here, and published in a later release.
      </p>

      <NewDraftForm />

      {drafts.isError ? (
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This view needs a connection.
        </p>
      ) : null}
      {drafts.isLoading ? (
        <p className="status-card">
          <GridIcon size={20} /> Loading…
        </p>
      ) : null}

      {drafts.isSuccess && visible.length === 0 ? (
        <p>No drafts yet. Start one above.</p>
      ) : null}

      {visible.length > 0 ? <DraftList drafts={visible} onDiscard={setDiscarding} /> : null}

      {/**
        Montaje condicional: cada apertura crea el diálogo de nuevo, así que `showModal()`
        corre una sola vez por borrador.
      */}
      {discarding ? (
        <DiscardDraftDialog
          draftId={discarding.id}
          draftName={discarding.name}
          onClose={() => setDiscarding(null)}
        />
      ) : null}
    </>
  );
}
