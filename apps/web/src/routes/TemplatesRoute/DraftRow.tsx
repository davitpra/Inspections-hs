import type { TemplateDraftSummary } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { formatInstant } from '../../presentation/dates';
import { draftStatusClass, draftStatusLabel } from '../../presentation/templates';
import { draftKindLabel } from './presentation';

export function DraftRow({
  draft,
  onDiscard,
}: {
  draft: TemplateDraftSummary;
  onDiscard: (draft: { id: string; name: string }) => void;
}): React.JSX.Element {
  return (
    <li className="list__row">
      <div>
        {/**
          El nombre es el link: abrir el borrador es lo que se hace con él el 95% de las veces,
          y un botón "Edit" al costado pondría dos objetivos donde hay uno.
        */}
        <Link
          className="draft-name"
          to="/templates/drafts/$id"
          params={{ id: draft.id }}
        >
          {draft.name}
        </Link>
        {/**
          La clave se muestra en el listado porque es lo que la plantilla va a llevar para
          siempre, y porque dos borradores con nombres parecidos se distinguen por ella y no
          por el nombre.
        */}
        <p className="note">
          {draft.key} · {draftKindLabel(draft)} · last saved {formatInstant(draft.updated_at)}
        </p>
      </div>

      <div className="list__aside">
        <span className={draftStatusClass(draft.publishable)}>
          {draftStatusLabel(draft.publishable)}
        </span>

        <button
          type="button"
          className="button--danger-quiet"
          aria-label={`Discard ${draft.name}`}
          onClick={() => onDiscard({ id: draft.id, name: draft.name })}
        >
          Discard
        </button>
      </div>
    </li>
  );
}
