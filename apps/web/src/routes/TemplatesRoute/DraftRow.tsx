import type { TemplateDraftSummary } from "@hs/contracts";
import { Link, useNavigate } from "@tanstack/react-router";

import { RowMenu, type RowAction } from "../../components/RowMenu";
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
 *
 * LAS ACCIONES VAN EN EL «⋮», COMO EN LA TABLA DE ARRIBA. Las dos tarjetas de esta pantalla
 * tabulan la misma silueta y el coordinador baja de una a la otra; un botón suelto acá y un
 * menú allá se leen como dos tablas de dos aplicaciones. Además, el botón suelto le daba a
 * descartar —lo único que no se deshace— el lugar más visible de la fila.
 *
 * LO QUE NO ENTRA AL MENÚ ES EL NOMBRE. Abrir el borrador es lo que se hace con él el 95% de
 * las veces, y esconder eso detrás de un clic para desplegarlo sería cobrar dos gestos por el
 * camino corto. «Edit draft» existe igual adentro, porque un menú de acciones que no ofrece
 * la principal obliga a saber que el título era un link.
 *
 * PUBLICAR APARECE Y DESAPARECE, no se dibuja en gris: el servidor rechaza publicar un
 * borrador incompleto (`template_draft_not_publishable`), así que ofrecerlo sería ofrecer un
 * error. Por qué no está se lee en la columna de estado, que ya dice "Not ready yet". Mismo
 * criterio que «Edit template» en una plantilla retirada (`PublishedRow`).
 */
export function DraftRow({
  draft,
  canPublish,
  onPublish,
  onDiscard,
}: {
  draft: TemplateDraftSummary;
  /** El rol que puede convertir un borrador en versión (`canPublishTemplates`). */
  canPublish: boolean;
  /** Publicar se confirma fuera de la fila: al aplicarse, la fila deja de existir. */
  onPublish: (draft: TemplateDraftSummary) => void;
  onDiscard: (draft: { id: string; name: string }) => void;
}): React.JSX.Element {
  const navigate = useNavigate();

  const actions: RowAction[] = [
    {
      label: "Edit draft",
      onSelect: () => {
        void navigate({
          to: "/templates/drafts/$id",
          params: { id: draft.id },
        });
      },
    },
  ];

  if (canPublish && draft.publishable) {
    actions.push({ label: "Publish", onSelect: () => onPublish(draft) });
  }

  actions.push({
    // "Discard this draft", como el «⋮» del builder, y no "Discard draft": ese es el botón
    // que confirma adentro del diálogo, y las dos etiquetas tienen que distinguirse.
    label: "Discard this draft",
    tone: "danger",
    onSelect: () => onDiscard({ id: draft.id, name: draft.name }),
  });

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
      <td data-label="Details" className="draft-row__meta">
        <span>{draft.key}</span>{' '}
        <span>{draftKindLabel(draft)}</span>
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
          <RowMenu label={`More actions for ${draft.name}`} actions={actions} />
        </div>
      </td>
    </tr>
  );
}
