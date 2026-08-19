import { useId } from 'react';
import type { ChoiceOption } from '@hs/contracts';

/**
 * Las opciones de un ítem `single_choice` o `multi_choice`.
 *
 * **Dos campos por opción y los dos visibles**, aunque tener uno solo sería más corto:
 *
 *   - `label` es lo que lee el inspector y puede reescribirse cuando se quiera;
 *   - `value` es lo que queda GUARDADO en cada respuesta, así que cambiarlo en una versión
 *     futura convierte todas las respuestas viejas en una opción que ya no existe.
 *
 * Derivar el `value` del `label` los ataría, y el día que alguien corrija una falta de
 * ortografía en la etiqueta se llevaría puesto el historial sin enterarse. Se propone uno
 * libre al agregar y se deja editable.
 */
export function ChoiceOptionsEditor({
  options,
  onChange,
  onAdd,
  onRemove,
}: {
  options: readonly ChoiceOption[];
  onChange: (index: number, change: Partial<ChoiceOption>) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}): React.JSX.Element {
  const controlId = useId();

  return (
    <div className="options">
      {options.length === 0 ? (
        <p className="note">No options yet. An item to choose from needs at least one.</p>
      ) : null}

      {options.map((option, index) => (
        // La clave es el índice y no el `value`: el `value` es editable y arranca vacío en
        // dos opciones nuevas seguidas, así que usarlo remontaría el input en cada tecla y
        // perdería el foco.
        <div key={index} className="options__row">
          <label htmlFor={`${controlId}-label-${index}`}>Label</label>
          <input
            id={`${controlId}-label-${index}`}
            type="text"
            value={option.label}
            placeholder="What the inspector reads"
            onChange={(event) => onChange(index, { label: event.target.value })}
          />

          <label htmlFor={`${controlId}-value-${index}`}>Stored value</label>
          <input
            id={`${controlId}-value-${index}`}
            type="text"
            value={option.value}
            placeholder="what-gets-recorded"
            onChange={(event) => onChange(index, { value: event.target.value })}
          />

          <button
            type="button"
            className="button--danger-quiet"
            aria-label={`Remove option ${option.label || index + 1}`}
            onClick={() => onRemove(index)}
          >
            Remove
          </button>
        </div>
      ))}

      <button type="button" onClick={onAdd}>
        Add option
      </button>
    </div>
  );
}
