import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { listTemplates } from '../../api/inspections';
import { listTemplateDrafts } from '../../api/templates';
import { queryKeys } from '../../api/query-keys';
import { DocumentIcon, GridIcon, InfoIcon } from '../../components/icons';
import { DiscardDraftDialog } from './DiscardDraftDialog';
import { DraftList } from './DraftList';
import { NewDraftForm } from './NewDraftForm';
import { PublishedTemplates } from './PublishedTemplates';
import { draftCountLabel, sortDrafts } from './presentation';

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

  const published = useQuery({
    queryKey: queryKeys.templates(),
    queryFn: listTemplates,
    retry: false,
  });

  const visible = sortDrafts(drafts.data ?? []);

  return (
    <>
      {/*
        El mismo encabezado que la consola de programación y que el builder: el coordinador
        se mueve entre las tres, y tres títulos con tres formas distintas se leen como tres
        aplicaciones. Ver `DraftHeader` en `TemplateDraftRoute`.
      */}
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <DocumentIcon size={22} />
            </span>
            <h1>Templates</h1>
          </div>
          <p className="scheduling__subtitle">
            Write the questions an inspection asks, and keep working on them until they are
            ready.
          </p>
        </div>
      </header>

      {/**
        Lo que esta pantalla NO hace, dicho arriba y no escondido en un botón deshabilitado:
        sin esta línea, el coordinador escribe una plantilla entera y recién al final
        descubre que no puede usarla.

        Es un `.notice-card` y no un `.notice`: enmarcado y tintado se lee antes que el
        formulario que tiene debajo, que es exactamente el orden en que hace falta.
      */}
      <div className="notice-card">
        <div className="notice-card__body">
          <span className="notice-card__icon">
            <InfoIcon size={20} />
          </span>
          <div>
            <p className="notice-card__title">Drafts become published templates</p>
            <p className="notice-card__text">
              Publish a completed draft to make it available for scheduling. Published versions
              are frozen, so review the questions carefully before you publish. Your published
              templates appear below.
            </p>
          </div>
        </div>
      </div>

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
        <div className="drafts-empty">
          <span className="drafts-empty__icon">
            <DocumentIcon size={22} />
          </span>
          <p className="drafts-empty__title">No drafts yet</p>
          <p className="note">Start one above. You can rename it later.</p>
        </div>
      ) : null}

      {/*
        La lista dentro de una tarjeta, con el conteo en el encabezado: es la única forma
        de saber de un vistazo cuánto hay sin contar renglones, y en una pantalla que
        crece hasta doce o quince borradores eso deja de ser obvio enseguida.
      */}
      {visible.length > 0 ? (
        <div className="card drafts-card">
          <div className="card__head">
            <h3>Your drafts</h3>
            <span className="note">{draftCountLabel(visible.length)}</span>
          </div>

          <DraftList drafts={visible} onDiscard={setDiscarding} />
        </div>
      ) : null}

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

      <PublishedTemplates
        templates={published.data ?? []}
        isLoading={published.isLoading}
        isError={published.isError}
      />
    </>
  );
}
