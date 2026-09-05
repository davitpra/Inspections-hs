import type { TemplateDraftSummary } from "@hs/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { listTemplateDrafts, publishTemplateDraft } from "../../api/templates";
import { queryKeys } from "../../api/query-keys";
import { DocumentIcon, GridIcon, InfoIcon } from "../../components/icons";
import { PublishDialog } from "../../components/PublishDialog";
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
export function TemplateDrafts({
  canPublish,
}: {
  /** El rol que puede convertir un borrador en versión (`canPublishTemplates`). */
  canPublish: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();

  /**
   * El borrador que se está descartando, ACÁ y no en la fila que lo originó: descartar
   * invalida el listado y la fila deja de montarse. El diálogo sobrevive porque cuelga de
   * la consola. Ver `DiscardDraftDialog.tsx`.
   */
  const [discarding, setDiscarding] = useState<{
    id: string;
    name: string;
  } | null>(null);

  /**
   * El borrador que se está publicando, ACÁ por el mismo motivo que el que se descarta: la
   * fila se va del listado al aplicarse. Y con él la mutación, que si colgara de la fila se
   * cancelaría a mitad de camino por el desmontaje que ella misma provoca.
   */
  const [publishing, setPublishing] = useState<TemplateDraftSummary | null>(
    null,
  );

  const drafts = useQuery({
    queryKey: queryKeys.templateDrafts(),
    queryFn: listTemplateDrafts,
    retry: false,
  });

  /**
   * Las TRES claves, y no las dos del builder. Acá el coordinador se queda mirando la
   * pantalla: el borrador sale de este listado (`templateDrafts`), la versión recién escrita
   * tiene que aparecer en la tarjeta de arriba sin recargar (`publishedTemplates`), y
   * `templates()` es lo programable de `/scheduling`, que acaba de ganar una plantilla.
   */
  const publish = useMutation({
    mutationFn: (draft: TemplateDraftSummary) => publishTemplateDraft(draft.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: queryKeys.templateDrafts(),
        }),
        queryClient.invalidateQueries({
          queryKey: queryKeys.publishedTemplates(),
        }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
      ]);
      setPublishing(null);
    },
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
          <DraftList
            drafts={visible}
            canPublish={canPublish}
            onPublish={setPublishing}
            onDiscard={setDiscarding}
          />
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

      {/**
        El mismo diálogo que confirma en el builder (`components/PublishDialog`), con el
        número que este borrador va a escribir: `next_version` viaja en el listado justo para
        que la confirmación nombre el registro sin abrirlo.
      */}
      {publishing ? (
        <PublishDialog
          draftName={publishing.name}
          nextVersion={publishing.next_version}
          revising={publishing.template_id !== null}
          publishing={publish.isPending}
          error={publish.isError ? publish.error.message : null}
          onClose={() => setPublishing(null)}
          onConfirm={() => publish.mutate(publishing)}
        />
      ) : null}
    </>
  );
}
