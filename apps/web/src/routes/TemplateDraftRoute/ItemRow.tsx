import { useId, useState } from 'react';
import type { ChoiceOption, ResponseType, TemplateDraftItem } from '@hs/contracts';

import { RowMenu } from '../../components/RowMenu';
import { GripIcon } from '../../components/icons';
import { RESPONSE_TYPE_HINTS, RESPONSE_TYPE_OPTIONS } from '../../presentation/templates';
import { ResponseTypeConfig } from './ResponseTypeConfig';
import { hasConfiguration } from './presentation';
import type { useSortable } from './useSortable';

/**
 * Una pregunta: qué se pregunta y cómo se contesta.
 *
 * UN SOLO RENGLÓN, que es lo que el mockup pide y lo que una plantilla de veinte preguntas
 * necesita: el texto, el tipo de respuesta y si es obligatoria se leen en línea, y una
 * sección entera entra en una pantalla en vez de en cuatro.
 *
 * **LA CONFIGURACIÓN DEL TIPO NO DESAPARECE, SE PLIEGA.** El mockup no la muestra porque
 * todas sus preguntas son Yes/No, pero `scale`, `number`, `text`, `single_choice`,
 * `multi_choice` y `photo` tienen campos sin los cuales el documento no se publica. Se abre
 * sola al elegir un tipo que los necesita: descubrir que faltaba configurar algo recién en
 * la lista de pendientes sería mandar al autor a buscar dónde.
 *
 * La identidad técnica se genera al crearla, no se deriva del texto y no forma parte de la
 * interfaz.
 */
export function ItemRow({
  item,
  index,
  count,
  sortable,
  onPrompt,
  onRequired,
  onResponseType,
  onNumber,
  onOptions,
  onMove,
  onDuplicate,
  onRemove,
}: {
  item: TemplateDraftItem;
  index: number;
  count: number;
  sortable: ReturnType<typeof useSortable>;
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
  onDuplicate: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const controlId = useId();
  const [open, setOpen] = useState(hasConfiguration(item.response_type));
  const label = item.prompt.trim() || `question ${index + 1}`;

  return (
    <li
      className={[
        'item-editor',
        sortable.dragging === index ? 'is-dragging' : '',
        sortable.isDropTarget(index) ? 'is-drop-target' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      data-sortable-group={sortable.group}
      data-sortable-index={index}
    >
      <div className="item-editor__row">
        <button
          type="button"
          className="builder__grip"
          aria-label={`Drag to reorder ${label}`}
          {...sortable.handleProps(index)}
        >
          <GripIcon />
        </button>

        <span className="builder__number builder__number--quiet" aria-hidden>
          {index + 1}.
        </span>

        <input
          id={`${controlId}-prompt`}
          className="item-editor__prompt"
          type="text"
          aria-label={`Question ${index + 1}`}
          value={item.prompt}
          placeholder="Is the machine guard fitted?"
          onChange={(event) => onPrompt(event.target.value)}
        />

        <div className="item-editor__type">
          <label className="field-label" htmlFor={`${controlId}-type`}>
            Answer type
          </label>
          <select
            id={`${controlId}-type`}
            value={item.response_type}
            onChange={(event) => {
              const next = event.target.value as ResponseType;

              onResponseType(next);
              // Se despliega sola cuando el tipo nuevo pide configuración. No se vuelve a
              // plegar al pasar a uno que no la pide: `ResponseTypeConfig` ya no dibuja
              // nada ahí, y cerrar el bloque movería la fila bajo el cursor.
              if (hasConfiguration(next)) setOpen(true);
            }}
          >
            {RESPONSE_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/*
          `<label>` envolvente es lo correcto para un checkbox y es la excepción a la regla
          de `htmlFor`/`id` que sigue el resto del archivo: el texto de un checkbox ES su
          área de click, y separarlos achica el objetivo a 13 píxeles en una tablet.
        */}
        <label className="item-editor__required">
          <input
            type="checkbox"
            checked={item.required}
            onChange={(event) => onRequired(event.target.checked)}
          />
          Required
        </label>

        <RowMenu
          label={`More actions for ${label}`}
          actions={[
            { label: 'Move up', disabled: index === 0, onSelect: () => onMove(-1) },
            { label: 'Move down', disabled: index === count - 1, onSelect: () => onMove(1) },
            { label: 'Duplicate question', onSelect: onDuplicate },
            {
              label: hasConfiguration(item.response_type)
                ? open
                  ? 'Hide answer settings'
                  : 'Show answer settings'
                : 'Show answer settings',
              disabled: !hasConfiguration(item.response_type),
              onSelect: () => setOpen((wasOpen) => !wasOpen),
            },
            { label: 'Remove question', tone: 'danger', onSelect: onRemove },
          ]}
        />
      </div>

      {open ? (
        <div className="item-editor__settings">
          <p className="note">{RESPONSE_TYPE_HINTS[item.response_type]}</p>
          <ResponseTypeConfig item={item} onNumber={onNumber} onOptions={onOptions} />
        </div>
      ) : null}
    </li>
  );
}
