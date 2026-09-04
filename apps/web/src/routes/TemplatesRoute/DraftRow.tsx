import type { TemplateDraftSummary } from "@hs/contracts";
import { Link } from "@tanstack/react-router";

import { formatInstant } from "../../presentation/dates";
import {
  draftStatusClass,
  draftStatusLabel,
} from "../../presentation/templates";
import { draftKindLabel } from "./presentation";

/**
 * Un borrador por fila, con `data-label` en cada celda.
 *
 * Los `data-label` no son decoración: en un teléfono la tabla colapsa a fichas y el
 * `::before` de cada celda los usa como etiqueta, igual que `PublishedRow`. Sin ellos, la
 * ficha queda como una lista de valores sin decir de qué.
 */
export function DraftRow({
  draft,
  onDiscard,
}: {
  draft: TemplateDraftSummary;
  onDiscard: (draft: { id: string; name: string }) => void;
}): React.JSX.Element {
  return (
    <tr className="draft-row">
      {/**
        El nombre es el link: abrir el borrador es lo que se hace con él el 95% de las veces,
        y un botón "Edit" al costado pondría dos objetivos donde hay uno.
      */}
      <th scope="row" data-label="Name">
        <Link
          className="draft-name"
          to="/templates/drafts/$id"
          params={{ id: draft.id }}
        >
          {draft.name}
        </Link>
      </th>

      {/**
        La clave se muestra en el listado porque es lo que la plantilla va a llevar para
        siempre, y porque dos borradores con nombres parecidos se distinguen por ella y no
        por el nombre.
      */}
      <td data-label="Version" className="draft-row__meta">
        {draftKindLabel(draft)}
      </td>

      <td data-label="Last saved" className="draft-row__meta">
        {formatInstant(draft.updated_at)}
      </td>

      <td data-label="Status">
        <span className={draftStatusClass(draft.publishable)}>
          {draftStatusLabel(draft.publishable)}
        </span>
      </td>

      <td data-label="Actions" className="drafts-card__actions-cell">
        <div className="table__actions">
          <button
            type="button"
            className="button--danger-quiet"
            aria-label={`Discard ${draft.name}`}
            onClick={() => onDiscard({ id: draft.id, name: draft.name })}
          >
            Discard
          </button>
        </div>
      </td>
    </tr>
  );
}
