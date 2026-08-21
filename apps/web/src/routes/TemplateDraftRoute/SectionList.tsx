import type {
  ChoiceOption,
  Location,
  OrganizationLocation,
  ResponseType,
  Site,
  TemplateDraftDocument,
} from "@hs/contracts";

import { PlusIcon } from "../../components/icons";
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
import { strandedSections } from "./presentation";
import { SectionCard } from "./SectionCard";
import { useSortable } from "./useSortable";

/**
 * El recorrido: las secciones en su orden, y el botón que agrega una más.
 *
 * Acá está TODO el cableado entre los gestos de una tarjeta y `edits.ts`. Es un archivo
 * largo de una sola forma repetida —cada acción es «llamá a la función pura y escribí lo
 * que devuelve»— y esa monotonía es lo que se busca: ninguna de estas líneas decide nada,
 * y la ruta no tiene por qué leerlas para entender qué se arma con qué.
 *
 * `write` recibe el documento entero porque las funciones de `edits.ts` son puras y
 * devuelven uno nuevo; el estado y el guardado siguen siendo de la ruta.
 */
export function SectionList({
  document,
  locations,
  organizationLocations,
  sites,
  siteIds,
  write,
}: {
  document: TemplateDraftDocument;
  locations: readonly Location[];
  organizationLocations: readonly OrganizationLocation[];
  sites: readonly Site[];
  siteIds: readonly string[];
  write: (next: TemplateDraftDocument) => void;
}): React.JSX.Element {
  const stranded = new Set(strandedSections(document, locations, siteIds));
  const sortable = useSortable("sections", (index, delta) =>
    write(moveSection(document, index, delta)),
  );
  const count = document.sections.length;

  return (
    <section className="builder__sections" aria-labelledby="builder-sections-title">
      <div className="builder__sections-head">
        <div>
          <h2 id="builder-sections-title">Inspection flow</h2>
          <p className="note">
            Arrange the sections and questions in the order inspectors will follow.
          </p>
        </div>
        <span className="status-pill status-pill--draft">
          {count} {count === 1 ? "section" : "sections"}
        </span>
      </div>

      {count === 0 ? (
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
          count={count}
          locations={locations}
          organizationLocations={organizationLocations}
          sites={sites}
          siteIds={siteIds}
          stranded={stranded.has(sectionIndex)}
          sortable={sortable}
          onLocation={(code) =>
            write(
              setSectionLocation(
                document,
                sectionIndex,
                code,
                organizationLocations.find((each) => each.code === code)?.name ?? "",
              ),
            )
          }
          onMove={(delta) => write(moveSection(document, sectionIndex, delta))}
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
            write(addItem(document, sectionIndex, newKey(allItemKeys(document))))
          }
          item={itemHandlers(document, sectionIndex, write)}
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
                newKey(document.sections.map((section) => section.section_key)),
              ),
            )
          }
        >
          <PlusIcon /> {count === 0 ? "Add your first section" : "Add section"}
        </button>
      </div>
    </section>
  );
}

/** Los gestos de una fila, ya atados a la sección en la que vive. */
function itemHandlers(
  document: TemplateDraftDocument,
  sectionIndex: number,
  write: (next: TemplateDraftDocument) => void,
): React.ComponentProps<typeof SectionCard>["item"] {
  return {
    /** La identidad se mantiene aunque la pregunta se reformule. */
    prompt: (itemIndex, prompt) =>
      write(setPrompt(document, sectionIndex, itemIndex, prompt)),
    required: (itemIndex, required) =>
      write(setRequired(document, sectionIndex, itemIndex, required)),
    responseType: (itemIndex, responseType: ResponseType) =>
      write(changeResponseType(document, sectionIndex, itemIndex, responseType)),
    number: (itemIndex, field, value) =>
      write(setConfig(document, sectionIndex, itemIndex, field, value)),
    optionChange: (itemIndex, optionIndex, change: Partial<ChoiceOption>) =>
      write(setOption(document, sectionIndex, itemIndex, optionIndex, change)),
    optionAdd: (itemIndex) => write(addOption(document, sectionIndex, itemIndex)),
    optionRemove: (itemIndex, optionIndex) =>
      write(removeOption(document, sectionIndex, itemIndex, optionIndex)),
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
    remove: (itemIndex) => write(removeItem(document, sectionIndex, itemIndex)),
  };
}
