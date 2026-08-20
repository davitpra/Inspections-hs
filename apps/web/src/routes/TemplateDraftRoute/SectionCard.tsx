import { useId, useState } from 'react';
import type {
  ChoiceOption,
  Location,
  OrganizationLocationOption,
  ResponseType,
  Site,
  TemplateDraftSection,
} from '@hs/contracts';

import { RowMenu } from '../../components/RowMenu';
import {
  BuildingIcon,
  ChevronIcon,
  CopyIcon,
  GripIcon,
  InfoIcon,
  PinIcon,
  PlusIcon,
  TrashIcon,
} from '../../components/icons';
import { ItemRow } from './ItemRow';
import { locationCoverage, offerableLocations, sectionAppliesTo } from './presentation';
import { useSortable } from './useSortable';

/**
 * Una sección: un bloque de preguntas con su lugar y su orden.
 *
 * La sección es la unidad con la que se recorre una inspección —«ahora la zona de carga»—,
 * así que es lo que se mueve en bloque. Mover un ítem ENTRE secciones no se ofrece: sería
 * cambiar a qué parte del recorrido pertenece la pregunta, y para eso está duplicarla donde
 * va y quitarla de acá.
 *
 * EL TÍTULO NO SE ESCRIBE, SE ELIGE. Sale del catálogo al elegir la ubicación, y por eso no
 * hay campo de texto ni el lápiz que dibuja el mockup: dos secciones con el mismo lugar y
 * distinto nombre serían dos nombres para un lugar que el catálogo definió una sola vez, y
 * el hallazgo que sale de acá se agrupa por la ubicación, no por el texto.
 *
 * LAS DOS CAJAS POR PLANTA SON DE SOLO LECTURA, y esa es la lectura correcta del mockup.
 * Una sección nombra UNA ubicación compartida; que en St. Thomas eso sea «Shipping dock» y
 * en Glencoe «Receiving dock» lo decide el mapeo de la consola de Locations. Dos selectores
 * de verdad volverían a partir la plantilla en dos, que es exactamente lo que
 * `organization_location` existe para evitar.
 */
export function SectionCard({
  section,
  index,
  count,
  locations,
  organizationLocations,
  sites,
  siteIds,
  stranded,
  sortable,
  onLocation,
  onMove,
  onDuplicate,
  onRemove,
  onAddItem,
  item,
}: {
  section: TemplateDraftSection;
  index: number;
  count: number;
  locations: readonly Location[];
  organizationLocations: readonly OrganizationLocationOption[];
  sites: readonly Site[];
  siteIds: readonly string[];
  stranded: boolean;
  sortable: ReturnType<typeof useSortable>;
  onLocation: (code: string) => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onAddItem: () => void;
  item: {
    prompt: (itemIndex: number, prompt: string) => void;
    required: (itemIndex: number, required: boolean) => void;
    responseType: (itemIndex: number, responseType: ResponseType) => void;
    number: (itemIndex: number, field: string, value: number) => void;
    optionChange: (itemIndex: number, optionIndex: number, change: Partial<ChoiceOption>) => void;
    optionAdd: (itemIndex: number) => void;
    optionRemove: (itemIndex: number, optionIndex: number) => void;
    move: (itemIndex: number, delta: number) => void;
    duplicate: (itemIndex: number) => void;
    remove: (itemIndex: number) => void;
  };
}): React.JSX.Element {
  const controlId = useId();
  const [open, setOpen] = useState(true);
  const items = useSortable(`${controlId}-items`, item.move);

  /**
   * Lo que un lector de pantalla anuncia al llegar a las acciones. Lleva la palabra
   * «section» siempre —también cuando hay título— para que no se confunda con las acciones
   * de una pregunta, que están un nivel adentro y dicen el texto de la pregunta pelado.
   */
  const label = section.section_title.trim()
    ? `section ${section.section_title.trim()}`
    : `section ${index + 1}`;

  const offered = offerableLocations(
    organizationLocations,
    locations,
    siteIds,
    section.organization_location_code,
  );
  const coverage = locationCoverage(section.organization_location_code, locations, siteIds);

  return (
    <section
      className={[
        'card',
        'builder__section',
        sortable.dragging === index ? 'is-dragging' : '',
        sortable.isDropTarget(index) ? 'is-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-sortable-group={sortable.group}
      data-sortable-index={index}
    >
      <div className="builder__section-head">
        <button
          type="button"
          className="builder__grip"
          aria-label={`Drag to reorder ${label}`}
          {...sortable.handleProps(index)}
        >
          <GripIcon />
        </button>

        <span className="builder__number" aria-hidden>
          {index + 1}
        </span>

        <div className="builder__section-title">
          <h2>{section.section_title.trim() || `Section ${index + 1}`}</h2>
          <p className="note">Section applies to: {sectionAppliesTo(section, locations, siteIds, sites)}</p>
        </div>

        <div className="builder__section-actions">
          <button type="button" onClick={onDuplicate} aria-label={`Duplicate ${label}`}>
            <CopyIcon /> Duplicate section
          </button>
          <button
            type="button"
            className="button--danger-quiet"
            onClick={onRemove}
            aria-label={`Remove ${label}`}
          >
            <TrashIcon /> Remove section
          </button>
          <button
            type="button"
            className={open ? 'builder__collapse' : 'builder__collapse is-closed'}
            aria-expanded={open}
            aria-label={open ? `Collapse ${label}` : `Expand ${label}`}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            <ChevronIcon />
          </button>
        </div>

        {/*
          El menú carga lo mismo que el arrastre, y por eso existe: es el camino de teclado
          de ADR-010. Deshabilitado en los extremos y no oculto — un botón que aparece y
          desaparece mueve los de al lado bajo el dedo.
        */}
        <RowMenu
          label={`More actions for ${label}`}
          actions={[
            { label: 'Move up', disabled: index === 0, onSelect: () => onMove(-1) },
            { label: 'Move down', disabled: index === count - 1, onSelect: () => onMove(1) },
          ]}
        />
      </div>

      {open ? (
        <>
          <div className="builder__field builder__section-location">
            <label className="field-label" htmlFor={`${controlId}-location`}>
              <PinIcon size={16} /> Location
            </label>
            <select
              id={`${controlId}-location`}
              value={section.organization_location_code ?? ''}
              onChange={(event) => onLocation(event.target.value)}
            >
              <option value="">Choose a location…</option>
              {offered.map((location) => (
                <option key={location.code} value={location.code}>
                  {location.name}
                </option>
              ))}
            </select>
            <p className="note">
              Locations are pulled from the places defined for each plant in Location mapping.
            </p>
          </div>

          {/*
            Una caja por planta del alcance, y el hueco se DIBUJA cuando no hay mapeo: es la
            respuesta útil —«esta sección no va a resolver en Glencoe»— y esconderla dejaría
            al autor descubriéndolo en el ingest, meses después.
          */}
          {section.organization_location_code ? (
            <div className="builder__resolution">
              {[...coverage].map(([siteId, resolved]) => {
                const site = sites.find((each) => each.id === siteId);

                return (
                  <div
                    key={siteId}
                    className={resolved ? 'builder__plant' : 'builder__plant builder__plant--gap'}
                  >
                    <p className="note">
                      <BuildingIcon size={16} /> {site?.name ?? 'Plant'} location
                    </p>
                    <p className="builder__plant-name">{resolved?.name ?? 'Not mapped here'}</p>
                  </div>
                );
              })}
            </div>
          ) : null}

          {stranded ? (
            <p className="notice notice--warn">
              <InfoIcon size={16} /> This location is not mapped at every plant in scope, so this
              section will not resolve everywhere. Map it in Location mapping, or choose another
              location.
            </p>
          ) : null}

          <p className="builder__questions-label">Questions ({section.items.length})</p>

          {section.items.length === 0 ? (
            <p className="note">
              A section needs at least one question before the template can be published.
            </p>
          ) : null}

          <ul className="list list--items builder__questions" {...items.listProps}>
            {section.items.map((each, itemIndex) => (
              // La clave es el índice y no `item_key`: la identidad técnica no forma parte
              // de la interfaz y el índice mantiene estable el foco mientras se edita.
              <ItemRow
                key={itemIndex}
                item={each}
                index={itemIndex}
                count={section.items.length}
                sortable={items}
                onPrompt={(prompt) => item.prompt(itemIndex, prompt)}
                onRequired={(required) => item.required(itemIndex, required)}
                onResponseType={(responseType) => item.responseType(itemIndex, responseType)}
                onNumber={(field, value) => item.number(itemIndex, field, value)}
                onOptions={{
                  change: (optionIndex, change) => item.optionChange(itemIndex, optionIndex, change),
                  add: () => item.optionAdd(itemIndex),
                  remove: (optionIndex) => item.optionRemove(itemIndex, optionIndex),
                }}
                onMove={(delta) => item.move(itemIndex, delta)}
                onDuplicate={() => item.duplicate(itemIndex)}
                onRemove={() => item.remove(itemIndex)}
              />
            ))}
          </ul>

          <div className="builder__add">
            <button type="button" onClick={onAddItem}>
              <PlusIcon /> Add question
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
