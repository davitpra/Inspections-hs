import { useId } from 'react';
import type {
  ChoiceOption,
  OrganizationLocationOption,
  ResponseType,
  TemplateDraftSection,
} from '@hs/contracts';

import { itemCountLabel } from '../../presentation/templates';
import { ItemRow } from './ItemRow';

/**
 * Una sección: un bloque de preguntas con su título y su orden.
 *
 * La sección es la unidad con la que se recorre una inspección —"ahora la zona de carga"—,
 * así que es lo que se mueve en bloque. Mover un ítem entre secciones no se ofrece: sería
 * cambiar a qué parte del recorrido pertenece la pregunta, y para eso está quitarla y
 * escribirla donde va.
 */
export function SectionCard({
  section,
  index,
  count,
  locations,
  onLocation,
  onMove,
  onRemove,
  onAddItem,
  item,
}: {
  section: TemplateDraftSection;
  locations: readonly OrganizationLocationOption[];
  index: number;
  count: number;
  onLocation: (code: string) => void;
  onMove: (delta: number) => void;
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
    remove: (itemIndex: number) => void;
  };
}): React.JSX.Element {
  const controlId = useId();
  /**
   * Lo que un lector de pantalla anuncia al llegar a los botones de orden. Lleva la palabra
   * "section" siempre —también cuando hay título— para que no se confunda con los botones de
   * una pregunta, que están tres niveles adentro y dicen el texto de la pregunta pelado.
   */
  const label = section.section_title.trim()
    ? `section ${section.section_title.trim()}`
    : `section ${index + 1}`;

  return (
    <section className="card">
      <div className="card__head">
        <div className="filters">
          <label htmlFor={`${controlId}-location`}>Location</label>
          <select
            id={`${controlId}-location`}
            value={section.organization_location_code ?? ''}
            onChange={(event) => onLocation(event.target.value)}
          >
            <option value="">Choose a location…</option>
            {locations.map((location) => (
              <option key={location.code} value={location.code}>
                {location.name}
              </option>
            ))}
          </select>
        </div>

        <div className="item-editor__order">
          <button
            type="button"
            aria-label={`Move ${label} up`}
            disabled={index === 0}
            onClick={() => onMove(-1)}
          >
            ↑
          </button>
          <button
            type="button"
            aria-label={`Move ${label} down`}
            disabled={index === count - 1}
            onClick={() => onMove(1)}
          >
            ↓
          </button>
          <button
            type="button"
            className="button--danger-quiet"
            aria-label={`Remove ${label}`}
            onClick={onRemove}
          >
            Remove section
          </button>
        </div>
      </div>

      <p className="note">{itemCountLabel(section.items.length)}</p>

      {section.items.length === 0 ? (
        <p className="note">
          A section needs at least one question before the template can be published.
        </p>
      ) : null}

      <ul className="list list--items">
        {section.items.map((each, itemIndex) => (
          // La clave es el índice y no `item_key`: la identidad técnica no forma parte de la
          // interfaz y el índice mantiene estable el foco mientras se edita la pregunta.
          <ItemRow
            key={itemIndex}
            item={each}
            index={itemIndex}
            count={section.items.length}
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
            onRemove={() => item.remove(itemIndex)}
          />
        ))}
      </ul>

      <div className="card__footer">
        <button type="button" onClick={onAddItem}>
          Add question
        </button>
      </div>
    </section>
  );
}
