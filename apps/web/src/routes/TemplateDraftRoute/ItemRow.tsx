import { useId } from 'react';
import type { ChoiceOption, ResponseType, TemplateDraftItem } from '@hs/contracts';

import { RESPONSE_TYPE_HINTS, RESPONSE_TYPE_OPTIONS } from '../../presentation/templates';
import { ResponseTypeConfig } from './ResponseTypeConfig';

/**
 * Una pregunta: qué se pregunta y cómo se contesta. La identidad técnica se genera al crearla,
 * no se deriva del texto y no forma parte de la interfaz.
 */
export function ItemRow({
  item,
  index,
  count,
  onPrompt,
  onRequired,
  onResponseType,
  onNumber,
  onOptions,
  onMove,
  onRemove,
}: {
  item: TemplateDraftItem;
  index: number;
  count: number;
  onPrompt: (prompt: string) => void;
  onRequired: (required: boolean) => void;
  onResponseType: (responseType: ResponseType) => void;
  onNumber: (field: string, value: number) => void;
  onOptions: {
    change: (optionIndex: number, change: Partial<ChoiceOption>) => void;
    add: () => void;
    remove: (optionIndex: number) => void;
  };
  onMove: (delta: number) => void;
  onRemove: () => void;
}): React.JSX.Element {
  const controlId = useId();
  const label = item.prompt.trim() || `question ${index + 1}`;

  return (
    <li className="item-editor">
      <div className="item-editor__head">
        <div className="filters">
          <label htmlFor={`${controlId}-prompt`}>Question</label>
          <input
            id={`${controlId}-prompt`}
            type="text"
            value={item.prompt}
            placeholder="Is the machine guard fitted?"
            onChange={(event) => onPrompt(event.target.value)}
          />
        </div>

        {/*
          Subir y bajar, no arrastrar. Sin dependencia nueva, alcanzable desde el teclado y
          usable con guantes en una tablet (ADR-010). Deshabilitados en los extremos en vez
          de ocultos: un botón que aparece y desaparece mueve los de al lado bajo el dedo.

          El `aria-label` nombra la pregunta y no dice solo "Move up", porque en una sección
          de diez ítems un lector de pantalla anunciaría diez botones idénticos.
        */}
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
            Remove
          </button>
        </div>
      </div>

      <div className="filters">
        <label htmlFor={`${controlId}-type`}>Answered with</label>
        <select
          id={`${controlId}-type`}
          value={item.response_type}
          onChange={(event) => onResponseType(event.target.value as ResponseType)}
        >
          {RESPONSE_TYPE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="note">{RESPONSE_TYPE_HINTS[item.response_type]}</span>
      </div>

      <ResponseTypeConfig item={item} onNumber={onNumber} onOptions={onOptions} />

      {/*
        `<label>` envolvente es lo correcto para un checkbox y es la excepción a la regla de
        `htmlFor`/`id` que sigue el resto del archivo: el texto de un checkbox ES su área de
        click, y separarlos achica el objetivo a 13 píxeles en una tablet.
      */}
      <label className="choices__option">
        <input
          type="checkbox"
          checked={item.required}
          onChange={(event) => onRequired(event.target.checked)}
        />
        Required
      </label>
    </li>
  );
}
