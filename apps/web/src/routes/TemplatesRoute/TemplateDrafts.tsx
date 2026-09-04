import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { listTemplateDrafts } from "../../api/templates";
import { queryKeys } from "../../api/query-keys";
import { DocumentIcon, GridIcon, InfoIcon } from "../../components/icons";
import { DiscardDraftDialog } from "./DiscardDraftDialog";
import { DraftList } from "./DraftList";
import { draftCountLabel, sortDrafts } from "./presentation";

/**
 * Los borradores, con la misma silueta que las publicadas de arriba.
 *
 * Es una tarjeta con encabezado y una mesa de cinco columnas, no una lista de renglones,
 * y no es una preferencia estética: el coordinador baja de una tarjeta a la otra en la
 * misma pantalla, y dos formas distintas de tabular las dos poblaciones se leen como dos
 * aplicaciones. Ver `PublishedTemplates.tsx`, de donde salen la estructura y el CSS.
 *
 * Lo que esta pantalla NO hace se dice en el subtítulo, arriba del listado y no escondido
 * en el editor: sin esa línea, el coordinador escribe una plantilla entera y recién al
 * final descubre cómo llega a estar disponible.
 */
export function TemplateDrafts(): React.JSX.Element {
  /**
   * El borrador que se está descartando, ACÁ y no en la fila que lo originó: descartar
   * invalida el listado y la fila deja de montarse. El diálogo sobrevive porque cuelga de
   * la consola. Ver `DiscardDraftDialog.tsx`.
   */
  const [discarding, setDiscarding] = useState<{
    id: string;
    name: string;
  } | null>(null);

  const drafts = useQuery({
    queryKey: queryKeys.templateDrafts(),
    queryFn: listTemplateDrafts,
    retry: false,
  });

  const visible = sortDrafts(drafts.data ?? []);

  return (
    <>
      <section className="drafts-card" aria-labelledby="template-drafts-heading">
        <div className="drafts-card__head">
          <div>
            <h2 id="template-drafts-heading">Your drafts</h2>
            <p className="note">
              Draft templates can continue to be edited until they are ready to
              publish. Published versions are frozen, so review the questions
              carefully before you publish.
            </p>
          </div>

          {/*
            El conteo solo cuando la consulta contestó: "0 drafts" mientras carga o
            mientras falla es una afirmación falsa sobre el trabajo de alguien. Mismo
            criterio que las fichas del encabezado de la ruta (`TemplateCounts`).
          */}
          {drafts.isSuccess ? (
            <span className="note">{draftCountLabel(visible.length)}</span>
          ) : null}
        </div>

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
            <p className="note">Select Add Template above to start one.</p>
          </div>
        ) : null}

        {visible.length > 0 ? (
          <DraftList drafts={visible} onDiscard={setDiscarding} />
        ) : null}
      </section>

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
