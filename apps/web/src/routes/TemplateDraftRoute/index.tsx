import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  draftIssues,
  type Location,
  type OrganizationLocation,
  type Site,
  type TemplateDraft,
  type TemplateDraftDocument,
} from "@hs/contracts";

import {
  listCatalogLocations,
  listOrganizationLocations,
} from "../../api/catalog";
import { listSites } from "../../api/inspections";
import {
  discardTemplateDraft,
  getTemplateDraft,
  publishTemplateDraft,
  saveTemplateDraft,
} from "../../api/templates";
import { queryKeys } from "../../api/query-keys";
import { useAppSession } from "../../app/session-context";
import { InfoIcon } from "../../components/icons";
import { canAuthorTemplates, canPublishTemplates } from "../../permissions/session";
import { DraftHeader } from "./DraftHeader";
import { PublishDialog } from "./PublishDialog";
import { canPublish as canPublishDraft, hasUnsavedChanges, saveErrorNotice } from "./presentation";
import { SectionList } from "./SectionList";
import { TemplateIdentity } from "./TemplateIdentity";
import { TemplateSummary } from "./TemplateSummary";

/**
 * §7 etapa 8 — Escribir una plantilla: para qué plantas vale, qué secciones tiene, qué
 * preguntas van en cada una y en qué orden.
 *
 * EL DOCUMENTO VIVE EN ESTADO LOCAL Y SE GUARDA A PEDIDO. No hay autosave ni actualización
 * optimista: el autor decide cuándo se escribe el documento completo.
 *
 * **Un rechazo NO borra lo escrito.** El documento sigue en el `useState`; el aviso dice qué
 * pasó y que nada se perdió. Descartar el trabajo del autor para volver a mostrar lo que el
 * servidor tiene sería la peor forma posible de informar un conflicto.
 *
 * **`draftIssues` corre acá, en cada tecla, con la MISMA función que el servidor.** Es de
 * `@hs/forms` (ADR-007): si fueran dos implementaciones, la pantalla diría que la plantilla
 * está lista y el servidor la rechazaría al publicar.
 *
 * **EL ALCANCE VIAJA CON EL DOCUMENTO Y NO POR SU CUENTA.** Cambiar para qué plantas vale la
 * plantilla es una edición como cualquier otra: entra en el mismo guardado y cae bajo el
 * mismo lock. Y no es un `site_id`: la plantilla sigue sin pertenecer a una planta —sigue
 * siendo UNA, con UN juego de `item_key`—; el alcance solo dice dónde se piensa usar, y su
 * consecuencia visible es qué ubicaciones puede nombrar cada sección.
 *
 * **La cobertura de ubicaciones se calcula acá y NO en `draftIssues`.** Esa función decide
 * sobre el documento y nada más; el catálogo de las dos plantas es una entrada que no tiene
 * y no puede pedir. Lo de acá es de la misma clase que `src/permissions/`: comodidad, no
 * garantía.
 *
 * **`visible_when` no se edita**, y el documento no lo pierde: los `edits` lo arrastran
 * intactos —salvo al duplicar, y ahí se dice por qué—. Su regla —la referencia tiene que
 * apuntar estrictamente hacia atrás— interactúa con el reordenamiento de una forma que
 * merece su propio change; mientras tanto, `PublishReadiness` reporta si algún
 * reordenamiento la rompió.
 */
export function TemplateDraftRoute(): React.JSX.Element {
  const { account } = useAppSession();
  const { id } = useParams({ from: "/templates/drafts/$id" });

  if (!canAuthorTemplates(account)) {
    return (
      <>
        <h1>Template</h1>
        <p className="notice">
          Only the H&amp;S coordinator can write templates.
        </p>
      </>
    );
  }

  // `key` remonta el editor entero al cambiar de borrador: el estado local es del documento
  // que se está editando, y arrastrarlo de uno a otro escribiría en el equivocado.
  return (
    <DraftEditor
      key={id}
      id={id}
      siteScope={account.siteScope}
      canPublish={canPublishTemplates(account)}
    />
  );
}

function DraftEditor({
  id,
  siteScope,
  canPublish,
}: {
  id: string;
  siteScope: readonly string[];
  canPublish: boolean;
}): React.JSX.Element {
  const draft = useQuery({
    queryKey: queryKeys.templateDraft(id),
    queryFn: () => getTemplateDraft(id),
    retry: false,
  });
  const organizationLocations = useQuery({
    queryKey: queryKeys.organizationLocations(),
    queryFn: listOrganizationLocations,
    retry: false,
  });
  /**
   * Las ubicaciones FÍSICAS, que la pantalla anterior no necesitaba. Son las que dicen qué
   * planta tiene tickeada cada compartida, y sin ellas no hay forma de recortar la oferta
   * de una sección ni de mostrar a qué lugar resuelve en cada planta.
   */
  const locations = useQuery({
    queryKey: queryKeys.catalogLocations(),
    queryFn: listCatalogLocations,
    retry: false,
  });
  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
    retry: false,
  });

  if (draft.isError) {
    return (
      <>
        <Link to="/templates" className="back-link">
          Templates
        </Link>
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> {(draft.error as Error).message}
        </p>
      </>
    );
  }

  if (!draft.data) {
    return (
      <>
        <Link to="/templates" className="back-link">
          Templates
        </Link>
        <p className="status-card">Loading…</p>
      </>
    );
  }

  /**
   * El formulario se monta recién con el borrador en la mano y siembra su estado del
   * `props`, sin un efecto que lo copie después.
   *
   * `key` es el id y NO el borrador entero: un refetch de fondo devuelve un objeto nuevo con
   * el mismo id, así que el formulario no se remonta y lo que se está escribiendo sobrevive.
   *
   * Las plantas se recortan por el alcance de la CUENTA: `listSites` puede devolver alguna
   * que esta no administra, y ofrecerla como opción de alcance sería ofrecer un rechazo —el
   * servidor la niega con `template_draft_site_out_of_scope`.
   */
  return (
      <DraftForm
      key={draft.data.id}
      id={id}
      loaded={draft.data}
      organizationLocations={organizationLocations.data ?? []}
      locations={locations.data ?? []}
        sites={(sites.data ?? []).filter((site) => siteScope.includes(site.id))}
        canPublish={canPublish}
      />
  );
}

function DraftForm({
  id,
  loaded,
  organizationLocations,
  locations,
  sites,
  canPublish: canPublishPermission,
}: {
  id: string;
  loaded: TemplateDraft;
  organizationLocations: readonly OrganizationLocation[];
  locations: readonly Location[];
  sites: readonly Site[];
  canPublish: boolean;
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [publishDialog, setPublishDialog] = useState(false);

  /**
   * Lo editado y lo último guardado, uno al lado del otro: el documento, el nombre y el
   * alcance se guardan de una sola vez, y comparar los dos lados es lo que dice si queda
   * algo pendiente.
   */
  const [edits, setEdits] = useState(() => {
    const loadedEdits = {
      document: loaded.document,
      name: loaded.name,
      siteIds: loaded.site_ids as readonly string[],
    };

    return { edited: loadedEdits, saved: loadedEdits };
  });
  const { document, name, siteIds } = edits.edited;

  const save = useMutation({
    mutationFn: () =>
      saveTemplateDraft(id, {
        name: name.trim(),
        document,
        site_ids: [...siteIds],
      }),
    onSuccess: (saved) => {
      const savedEdits = {
        document: saved.document,
        name: saved.name,
        siteIds: saved.site_ids as readonly string[],
      };

      setEdits({ edited: savedEdits, saved: savedEdits });

      void queryClient.invalidateQueries({
        queryKey: queryKeys.templateDrafts(),
      });
    },
  });

  const discard = useMutation({
    mutationFn: () => discardTemplateDraft(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.templateDrafts(),
      });
      void navigate({ to: "/templates" });
    },
  });

  const publish = useMutation({
    mutationFn: () => publishTemplateDraft(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.templateDrafts() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.templates() }),
      ]);
      void navigate({ to: "/templates" });
    },
  });

  /** Escribe una edición sin tocar lo que ya fue guardado. */
  const edit = (change: Partial<typeof edits.edited>): void =>
    setEdits((current) => ({
      ...current,
      edited: { ...current.edited, ...change },
    }));

  const dirty = hasUnsavedChanges(edits.edited, edits.saved);
  const issues = draftIssues(document);
  const revising = loaded.template_id !== null;

  return (
    <>
      <Link to="/templates" className="back-link">
        Templates
      </Link>

      <DraftHeader
        revising={revising}
        templateName={loaded.name}
        nextVersion={loaded.next_version}
        dirty={dirty}
        onDiscard={() => discard.mutate()}
      />

      {publishDialog ? (
        <PublishDialog
          draftName={name}
          nextVersion={loaded.next_version}
          revising={revising}
          publishing={publish.isPending}
          error={publish.isError ? (publish.error as Error).message : null}
          onClose={() => setPublishDialog(false)}
          onConfirm={() => publish.mutate()}
        />
      ) : null}

      {save.isError ? (
        <p className="notice notice--warn">
          {saveErrorNotice((save.error as Error).message)}
        </p>
      ) : null}

      <div className="builder__layout">
        <div>
          <TemplateIdentity
            name={name}
            templateKey={loaded.key}
            revising={revising}
            sites={sites}
            siteIds={siteIds}
            onName={(next) => edit({ name: next })}
            onScope={(next) => edit({ siteIds: next })}
          />

          <SectionList
            document={document}
            locations={locations}
            organizationLocations={organizationLocations}
            sites={sites}
            siteIds={siteIds}
            write={(next: TemplateDraftDocument) => edit({ document: next })}
          />
        </div>

        <TemplateSummary
          document={document}
          issues={issues}
          locations={locations}
          sites={sites}
          siteIds={siteIds}
          dirty={dirty}
          saving={save.isPending}
          canSave={
            dirty && !save.isPending && name.trim() !== "" && siteIds.length > 0
          }
          canPublish={canPublishPermission && canPublishDraft(dirty, issues)}
          publishing={publish.isPending}
          onSave={() => save.mutate()}
          onPublish={() => setPublishDialog(true)}
        />
      </div>
    </>
  );
}
