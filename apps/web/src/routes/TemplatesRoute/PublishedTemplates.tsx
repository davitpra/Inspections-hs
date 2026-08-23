import type { TemplateOption } from '@hs/contracts';

import { CheckIcon, GridIcon, InfoIcon } from '../../components/icons';
import {
  publishedCountLabel,
  sortPublishedTemplates,
} from './presentation';
import { PublishedRow } from './PublishedRow';

/** Las publicadas son registros congelados: la fila abre su documento, no un editor. */
export function PublishedTemplates({
  templates,
  isLoading,
  isError,
}: {
  templates: readonly TemplateOption[];
  isLoading: boolean;
  isError: boolean;
}): React.JSX.Element {
  const visible = sortPublishedTemplates(templates);

  return (
    <section className="card published-card">
      <div className="card__head">
        <h3>Published templates</h3>
        <span className="note">{publishedCountLabel(visible.length)}</span>
      </div>

      {isError ? (
        <p className="status-card status-card--error">
          <InfoIcon size={20} /> This view needs a connection.
        </p>
      ) : null}
      {isLoading ? (
        <p className="status-card">
          <GridIcon size={20} /> Loading…
        </p>
      ) : null}

      {!isLoading && !isError && visible.length === 0 ? (
        <div className="published-empty">
          <span className="published-empty__icon">
            <CheckIcon size={22} />
          </span>
          <p className="published-empty__title">No published templates yet</p>
          <p className="note">Publish a completed draft to fill this list.</p>
        </div>
      ) : null}

      {!isLoading && !isError && visible.length > 0 ? (
        <ul className="list">
          {visible.map((template) => (
            <PublishedRow key={template.id} template={template} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
