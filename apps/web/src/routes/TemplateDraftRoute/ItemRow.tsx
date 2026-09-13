import { useId } from "react";
import type { ResponseType, TemplateDraftItem } from "@hs/contracts";

import { RowMenu } from "../../components/RowMenu";
import { GearIcon, GripIcon } from "../../components/icons";
import { RESPONSE_TYPE_OPTIONS } from "../../presentation/templates";
import { hasConfiguration } from "./presentation";
import type { useSortable } from "./useSortable";

/**
 * Una pregunta: qué se pregunta y cómo se contesta.
 *
 * LA PREGUNTA TIENE SU PROPIO RENGLÓN. Los controles secundarios van debajo para que escribir
 * una pregunta larga no compita con el tipo, Required y el menú de acciones.
 *
 * **LA CONFIGURACIÓN DEL TIPO VIVE EN EL SHEET DE LA PREGUNTA, NO EN LA FILA.** El mockup
 * no la muestra porque todas sus preguntas son Yes/No, pero `scale`, `number`, `text`,
 * `single_choice`, `multi_choice` y `photo` tienen campos sin los cuales el documento no se
 * publica. El engranaje abre el sheet, y el sheet se abre solo al elegir un tipo que los
 * necesita: descubrir que faltaba configurar algo recién en la lista de pendientes sería
 * mandar al autor a buscar dónde.
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
  onOpenSettings,
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
  onOpenSettings: () => void;
  onMove: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}): React.JSX.Element {
  const controlId = useId();
  const label = item.prompt.trim() || `question ${index + 1}`;

  return (
    <li
      className={[
        "item-editor",
        sortable.dragging === index ? "is-dragging" : "",
        sortable.isDropTarget(index) ? "is-drop-target" : "",
      ]
        .filter(Boolean)
        .join(" ")}
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

        <div className="item-editor__controls">
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
                // La escritura del tipo y la apertura van en el mismo evento: el sheet monta
                // ya con el ítem del tipo nuevo y su configuración por defecto.
                if (hasConfiguration(next)) onOpenSettings();
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
            Siempre, también en los tipos sin configuración: el sheet es además donde se
            escribe la acción correctiva, y `signature` también puede prescribir una.
          */}
          <button
            type="button"
            className="item-editor__settings-toggle"
            aria-haspopup="dialog"
            title="Edit settings"
            aria-label="Edit settings"
            onClick={onOpenSettings}
          >
            <GearIcon size={18} />
          </button>
        </div>

        <RowMenu
          label={`More actions for ${label}`}
          actions={[
            {
              label: "Move up",
              disabled: index === 0,
              onSelect: () => onMove(-1),
            },
            {
              label: "Move down",
              disabled: index === count - 1,
              onSelect: () => onMove(1),
            },
            { label: "Duplicate question", onSelect: onDuplicate },
            { label: "Edit question settings", onSelect: onOpenSettings },
            { label: "Remove question", tone: "danger", onSelect: onRemove },
          ]}
        />
      </div>
    </li>
  );
}
