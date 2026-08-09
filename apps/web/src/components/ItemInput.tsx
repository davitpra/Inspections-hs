import { YES_NO_NA_VALUES, type TemplateItem } from '@hs/forms';

import type { PhotoRow } from '../offline/db';
import { PhotoField } from './PhotoField';

/**
 * Los nueve tipos de ítem, renderizados contra el documento CONGELADO.
 *
 * La configuración —el rango de la escala, el largo del texto, las opciones, cuántas
 * fotos— sale del documento y no de este archivo. El cliente no tiene una segunda
 * opinión sobre qué es válido: `validateAnswers` de `@hs/forms` es la misma función que
 * el servidor corre al recibir el envío (ADR-007), y por eso acá no hay una sola regla
 * de validación escrita a mano.
 */

export interface ItemInputProps {
  item: TemplateItem;
  value: unknown;
  onChange: (value: unknown) => void;
  photos: PhotoRow[];
  onCapturePhoto: (blob: Blob) => void;
  onDiscardPhoto: (photoId: string) => void;
  invalid: boolean;
}

export function ItemInput(props: ItemInputProps): React.JSX.Element {
  const { item, value, onChange } = props;
  const inputId = `item-${item.item_key}`;

  switch (item.response_type) {
    case 'yes_no':
      return (
        <ChoiceButtons
          id={inputId}
          options={[
            { value: true, label: 'Yes' },
            { value: false, label: 'No' },
          ]}
          selected={value}
          onSelect={onChange}
        />
      );

    case 'yes_no_na':
      return (
        <ChoiceButtons
          id={inputId}
          options={YES_NO_NA_VALUES.map((option) => ({
            value: option,
            label: option === 'na' ? 'N/A' : option === 'yes' ? 'Yes' : 'No',
          }))}
          selected={value}
          onSelect={onChange}
        />
      );

    case 'scale':
      return (
        <ChoiceButtons
          id={inputId}
          options={range(item.min, item.max).map((step) => ({
            value: step,
            label: String(step),
          }))}
          selected={value}
          onSelect={onChange}
        />
      );

    case 'text':
      return (
        <textarea
          id={inputId}
          value={typeof value === 'string' ? value : ''}
          maxLength={item.max_length}
          rows={3}
          aria-invalid={props.invalid}
          onChange={(event) => onChange(event.target.value)}
        />
      );

    case 'number':
      return (
        <input
          id={inputId}
          type="number"
          inputMode="decimal"
          min={item.min}
          max={item.max}
          step={item.decimals === 0 ? 1 : 10 ** -item.decimals}
          value={typeof value === 'number' ? value : ''}
          aria-invalid={props.invalid}
          onChange={(event) =>
            onChange(event.target.value === '' ? null : Number(event.target.value))
          }
        />
      );

    case 'single_choice':
      return (
        <ChoiceButtons
          id={inputId}
          options={item.options.map((option) => ({ value: option.value, label: option.label }))}
          selected={value}
          onSelect={onChange}
        />
      );

    case 'multi_choice': {
      const selected = Array.isArray(value) ? (value as string[]) : [];

      return (
        <fieldset id={inputId} className="choices">
          {item.options.map((option) => (
            <label key={option.value} className="choices__option">
              <input
                type="checkbox"
                checked={selected.includes(option.value)}
                onChange={() =>
                  onChange(
                    selected.includes(option.value)
                      ? selected.filter((entry) => entry !== option.value)
                      : [...selected, option.value],
                  )
                }
              />
              {option.label}
            </label>
          ))}
        </fieldset>
      );
    }

    case 'photo':
      return (
        <PhotoField
          id={inputId}
          photos={props.photos}
          maxCount={item.max_count}
          onCapture={props.onCapturePhoto}
          onDiscard={props.onDiscardPhoto}
        />
      );

    case 'signature':
      /**
       * La firma viaja como object key, igual que las fotos (ADR-001): se sube antes
       * del envío y el envío la referencia. El trazo se captura como imagen y entra por
       * el mismo camino que una foto.
       */
      return (
        <PhotoField
          id={inputId}
          photos={props.photos}
          maxCount={1}
          label="Sign"
          onCapture={props.onCapturePhoto}
          onDiscard={props.onDiscardPhoto}
        />
      );
  }
}

interface Option {
  value: unknown;
  label: string;
}

function ChoiceButtons({
  id,
  options,
  selected,
  onSelect,
}: {
  id: string;
  options: Option[];
  selected: unknown;
  onSelect: (value: unknown) => void;
}): React.JSX.Element {
  return (
    <div id={id} className="choices" role="group">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === selected ? 'choices__button is-selected' : 'choices__button'}
          aria-pressed={option.value === selected}
          // Deseleccionar tocando de nuevo: sin esto, un `yes_no` contestado por error
          // no se puede dejar sin contestar, y "sin contestar" es un estado que el motor
          // distingue de cualquier respuesta.
          onClick={() => onSelect(option.value === selected ? null : option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function range(min: number, max: number): number[] {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}
