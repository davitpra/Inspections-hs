import { useId } from 'react';
import type { ChoiceOption, TemplateDraftItem } from '@hs/contracts';

import { ChoiceOptionsEditor } from './ChoiceOptionsEditor';

/**
 * Los campos que cada tipo de respuesta necesita, y solo los de su tipo.
 *
 * **Un `switch` sobre `response_type` y no un formulario con todo opcional.** La
 * configuración de cada tipo es un `strictObject`: un `max_length` que sobreviva a un ítem
 * pasado a `single_choice` no es un campo de más, es un documento que se rechaza al
 * publicar. Que la pantalla no pueda siquiera mostrar el campo equivocado es la mitad de la
 * defensa; la otra la pone `changeResponseType` en `edits.ts`, que reemplaza la
 * configuración en vez de mezclarla.
 *
 * Cuatro de los nueve tipos no configuran nada —`yes_no`, `yes_no_na`, `signature` y el
 * `default`— y devuelven `null` en vez de un bloque vacío.
 *
 * **Los números se leen como números.** `Number(event.target.value)` sobre un input vacío da
 * `NaN`, que rompería el esquema; se cae al valor actual, así que borrar el campo deja lo
 * que había hasta que se escriba otra cosa. Un valor fuera de rango sí entra y lo reporta
 * `draftIssues`: un mínimo mayor que el máximo es algo que se está terminando de escribir,
 * no un error de tipeo que haya que impedir.
 */
export function ResponseTypeConfig({
  item,
  onNumber,
  onOptions,
}: {
  item: TemplateDraftItem;
  onNumber: (field: string, value: number) => void;
  onOptions: {
    change: (index: number, change: Partial<ChoiceOption>) => void;
    add: () => void;
    remove: (index: number) => void;
  };
}): React.JSX.Element | null {
  const controlId = useId();

  const number = (
    label: string,
    field: string,
    value: number,
    hint?: string,
  ): React.JSX.Element => (
    <div className="filters">
      <label htmlFor={`${controlId}-${field}`}>{label}</label>
      <input
        id={`${controlId}-${field}`}
        type="number"
        value={value}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          onNumber(field, Number.isNaN(parsed) ? value : parsed);
        }}
      />
      {hint ? <span className="note">{hint}</span> : null}
    </div>
  );

  switch (item.response_type) {
    case 'scale':
      return (
        <>
          {number('Lowest', 'min', item.min)}
          {number('Highest', 'max', item.max, 'Whole numbers, and the lowest must be lower.')}
        </>
      );

    case 'text':
      return number('Maximum length', 'max_length', item.max_length, 'In characters.');

    case 'number':
      return (
        <>
          {number('Minimum', 'min', item.min)}
          {number('Maximum', 'max', item.max)}
          {number('Decimal places', 'decimals', item.decimals, 'Use 0 for whole numbers.')}
        </>
      );

    case 'single_choice':
      return (
        <ChoiceOptionsEditor
          options={item.options}
          onChange={onOptions.change}
          onAdd={onOptions.add}
          onRemove={onOptions.remove}
        />
      );

    case 'multi_choice':
      return (
        <>
          <ChoiceOptionsEditor
            options={item.options}
            onChange={onOptions.change}
            onAdd={onOptions.add}
            onRemove={onOptions.remove}
          />
          {number('Fewest selections', 'min_selected', item.min_selected)}
          {number(
            'Most selections',
            'max_selected',
            item.max_selected,
            'Neither can ask for more than the options offered.',
          )}
        </>
      );

    case 'photo':
      return (
        <>
          {number('Fewest photos', 'min_count', item.min_count)}
          {number('Most photos', 'max_count', item.max_count)}
        </>
      );

    default:
      // `yes_no`, `yes_no_na` y `signature` no configuran nada.
      return null;
  }
}
