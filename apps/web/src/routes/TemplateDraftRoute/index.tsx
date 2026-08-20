import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import {
  draftIssues,
  type ChoiceOption,
  type Location,
  type OrganizationLocation,
  type ResponseType,
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
  saveTemplateDraft,
} from "../../api/templates";
import { queryKeys } from "../../api/query-keys";
import { useAppSession } from "../../app/session-context";
import { InfoIcon, PlusIcon } from "../../components/icons";
import { canAuthorTemplates } from "../../permissions/session";
import { DraftHeader } from "./DraftHeader";
import {
  addItem,
  addOption,
  addSection,
  allItemKeys,
  changeResponseType,
  duplicateItem,
  duplicateSection,
  moveItem,
  moveSection,
  removeItem,
  removeOption,
  removeSection,
  setConfig,
  setOption,
  setPrompt,
  setRequired,
  setSectionLocation,
} from "./edits";
import { newKey, newKeys } from "./newKey";
import {
  hasUnsavedChanges,
  saveErrorNotice,
  strandedSections,
} from "./presentation";
import { SectionCard } from "./SectionCard";
import { TemplateIdentity } from "./TemplateIdentity";
import { TemplateSummary } from "./TemplateSummary";
import { useSortable } from "./useSortable";

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
  return <DraftEditor key={id} id={id} siteScope={account.siteScope} />;
}

function DraftEditor({
  id,
  siteScope,
}: {
  id: string;
  siteScope: readonly string[];
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
    />
  );
}

function DraftForm({
  id,
  loaded,
  organizationLocations,
  locations,
  sites,
}: {
  id: string;
  loaded: TemplateDraft;
  organizationLocations: readonly OrganizationLocation[];
  locations: readonly Location[];
  sites: readonly Site[];
}): React.JSX.Element {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  /** El documento, el nombre y el alcance en edición. */
  const [edited, setEdited] = useState(() => ({
    document: loaded.document,
    name: loaded.name,
    siteIds: loaded.site_ids,
    savedDocument: loaded.document,
    savedName: loaded.name,
    savedSiteIds: loaded.site_ids,
  }));

  const save = useMutation({
    mutationFn: () =>
      saveTemplateDraft(id, {
        name: edited.name.trim(),
        document: edited.document,
        site_ids: [...edited.siteIds],
      }),
    onSuccess: (saved) => {
      setEdited({
        document: saved.document,
        name: saved.name,
        siteIds: saved.site_ids,
        savedDocument: saved.document,
        savedName: saved.name,
        savedSiteIds: saved.site_ids,
      });

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

  const { document, siteIds } = edited;

  /** Escribe el documento editado sin tocar lo que ya fue guardado. */
  const write = (next: TemplateDraftDocument): void =>
    setEdited((current) => ({ ...current, document: next }));

  const dirty =
    hasUnsavedChanges(
      edited.document,
      edited.savedDocument,
      edited.name,
      edited.savedName,
    ) ||
    JSON.stringify([...edited.siteIds].sort()) !==
      JSON.stringify([...edited.savedSiteIds].sort());

  const issues = draftIssues(document);
  const stranded = new Set(strandedSections(document, locations, siteIds));
  const sections = useSortable("sections", (index, delta) =>
    write(moveSection(document, index, delta)),
  );

  return (
    <>
      <Link to="/templates" className="back-link">
        Templates
      </Link>

      <DraftHeader
        dirty={dirty}
        saving={save.isPending}
        canSave={
          dirty &&
          !save.isPending &&
          edited.name.trim() !== "" &&
          siteIds.length > 0
        }
        onSave={() => save.mutate()}
        onDiscard={() => discard.mutate()}
      />

      {save.isError ? (
        <p className="notice notice--warn">
          {saveErrorNotice((save.error as Error).message)}
        </p>
      ) : null}

      <div className="builder__layout">
        <div>
          <TemplateIdentity
            name={edited.name}
            templateKey={loaded.key}
            sites={sites}
            siteIds={siteIds}
            onName={(name) => setEdited((current) => ({ ...current, name }))}
            onScope={(next) =>
              setEdited((current) => ({ ...current, siteIds: next }))
            }
          />

          <section className="builder__sections" aria-labelledby="builder-sections-title">
            <div className="builder__sections-head">
              <div>
                <h2 id="builder-sections-title">Inspection flow</h2>
                <p className="note">
                  Arrange the sections and questions in the order inspectors will follow.
                </p>
              </div>
              <span className="status-pill status-pill--draft">
                {document.sections.length}{" "}
                {document.sections.length === 1 ? "section" : "sections"}
              </span>
            </div>

            {document.sections.length === 0 ? (
              <div className="builder__empty-sections">
                <p className="builder__empty-sections-title">Your flow is empty</p>
                <p className="note">
                  Start with a section for the first area an inspector will check.
                </p>
              </div>
            ) : null}

            {document.sections.map((section, sectionIndex) => (
              // Índice como clave: las identidades técnicas no forman parte de la interfaz y
              // el índice mantiene estable el foco mientras se edita.
              <SectionCard
                key={sectionIndex}
                section={section}
                index={sectionIndex}
                count={document.sections.length}
                locations={locations}
                organizationLocations={organizationLocations}
                sites={sites}
                siteIds={siteIds}
                stranded={stranded.has(sectionIndex)}
                sortable={sections}
                onLocation={(code) => {
                  const location = organizationLocations.find(
                    (each) => each.code === code,
                  );
                  write(
                    setSectionLocation(
                      document,
                      sectionIndex,
                      code,
                      location?.name ?? "",
                    ),
                  );
                }}
                onMove={(delta) =>
                  write(moveSection(document, sectionIndex, delta))
                }
                onDuplicate={() => {
                  const taken = [
                    ...allItemKeys(document),
                    ...document.sections.map((each) => each.section_key),
                  ];
                  const minted = newKeys(section.items.length + 1, taken);

                  write(
                    duplicateSection(document, sectionIndex, {
                      section: minted[0]!,
                      items: minted.slice(1),
                    }),
                  );
                }}
                onRemove={() => write(removeSection(document, sectionIndex))}
                onAddItem={() =>
                  write(
                    addItem(
                      document,
                      sectionIndex,
                      newKey(allItemKeys(document)),
                    ),
                  )
                }
                item={{
                  /** La identidad se mantiene aunque la pregunta se reformule. */
                  prompt: (itemIndex, prompt) =>
                    write(setPrompt(document, sectionIndex, itemIndex, prompt)),
                  required: (itemIndex, required) =>
                    write(
                      setRequired(document, sectionIndex, itemIndex, required),
                    ),
                  responseType: (itemIndex, responseType: ResponseType) =>
                    write(
                      changeResponseType(
                        document,
                        sectionIndex,
                        itemIndex,
                        responseType,
                      ),
                    ),
                  number: (itemIndex, field, value) =>
                    write(
                      setConfig(document, sectionIndex, itemIndex, field, value),
                    ),
                  optionChange: (
                    itemIndex,
                    optionIndex,
                    change: Partial<ChoiceOption>,
                  ) =>
                    write(
                      setOption(
                        document,
                        sectionIndex,
                        itemIndex,
                        optionIndex,
                        change,
                      ),
                    ),
                  optionAdd: (itemIndex) =>
                    write(addOption(document, sectionIndex, itemIndex)),
                  optionRemove: (itemIndex, optionIndex) =>
                    write(
                      removeOption(
                        document,
                        sectionIndex,
                        itemIndex,
                        optionIndex,
                      ),
                    ),
                  move: (itemIndex, delta) =>
                    write(moveItem(document, sectionIndex, itemIndex, delta)),
                  duplicate: (itemIndex) =>
                    write(
                      duplicateItem(
                        document,
                        sectionIndex,
                        itemIndex,
                        newKey(allItemKeys(document)),
                      ),
                    ),
                  remove: (itemIndex) =>
                    write(removeItem(document, sectionIndex, itemIndex)),
                }}
              />
            ))}

            <div className="builder__add builder__add--section">
              <button
                type="button"
                className="button--primary"
                onClick={() =>
                  write(
                    addSection(
                      document,
                      newKey(
                        document.sections.map((section) => section.section_key),
                      ),
                    ),
                  )
                }
              >
                <PlusIcon />{" "}
                {document.sections.length === 0 ? "Add your first section" : "Add section"}
              </button>
            </div>
          </section>
        </div>

        <TemplateSummary
          document={document}
          issues={issues}
          locations={locations}
          sites={sites}
          siteIds={siteIds}
        />
      </div>
    </>
  );
}
