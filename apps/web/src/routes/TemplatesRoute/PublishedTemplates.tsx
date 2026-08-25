import type { PublishedTemplateSummary } from '@hs/contracts';
import { useState } from 'react';

import { CheckIcon, GridIcon, InfoIcon } from '../../components/icons';
import { DeactivateTemplateDialog } from './DeactivateTemplateDialog';
import { NewDraftForm } from './NewDraftForm';
import { splitPublishedTemplates } from './presentation';
import { PublishedRow } from './PublishedRow';

/** Las publicadas son registros congelados: la fila abre su documento, no un editor. */
export function PublishedTemplates({
  templates,
  isLoading,
  isError,
  canManage,
}: {
  templates: readonly PublishedTemplateSummary[];
  isLoading: boolean;
  isError: boolean;
  canManage: boolean;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const [deactivating, setDeactivating] = useState<PublishedTemplateSummary | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [archiving, setArchiving] = useState<PublishedTemplateSummary | null>(null);
  const { visible, archived } = splitPublishedTemplates(templates);
  const rows = showArchived ? [...visible, ...archived] : visible;

  return (
    <section className="published-card" aria-labelledby="published-templates-heading">
      <div className="published-card__head">
        <div>
          <h2 id="published-templates-heading">
             Published templates <span className="note" aria-hidden="true">({visible.length})</span>
          </h2>
          <p className="note">Published templates are ready to use when scheduling inspections.</p>
        </div>
         <div className="published-card__controls">
           {canManage && archived.length > 0 ? (
             <label className="archive-toggle">
               <input
                 type="checkbox"
                 checked={showArchived}
                 onChange={(event) => setShowArchived(event.target.checked)}
               />{' '}
               Show archived
             </label>
           ) : null}
           <button
             type="button"
             className="button--primary published-card__add"
             onClick={() => setAdding(true)}
           >
             Add Template
           </button>
         </div>
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

       {!isLoading && !isError && rows.length === 0 ? (
        <div className="published-empty">
          <span className="published-empty__icon">
            <CheckIcon size={22} />
          </span>
           <p className="published-empty__title">{archived.length > 0 ? 'No visible published templates' : 'No published templates yet'}</p>
           <p className="note">{archived.length > 0 ? 'Show archived templates to see the full list.' : 'Publish a completed draft to fill this list.'}</p>
        </div>
      ) : null}

       {!isLoading && !isError && rows.length > 0 ? (
        <table className="table published-card__table" aria-label="Published templates">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Version</th>
              <th scope="col">Published</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
             {rows.map((template) => (
              <PublishedRow
                key={template.id}
                template={template}
                canManage={canManage}
                 onDeactivate={() => setDeactivating(template)}
                 onArchive={() => setArchiving(template)}
              />
            ))}
          </tbody>
        </table>
      ) : null}

      {adding ? <NewDraftForm onClose={() => setAdding(false)} /> : null}
      {deactivating ? (
        <DeactivateTemplateDialog template={deactivating} onClose={() => setDeactivating(null)} />
      ) : null}
      {archiving ? (
        <DeactivateTemplateDialog
          template={archiving}
          kind="archive"
          onClose={() => setArchiving(null)}
        />
      ) : null}
    </section>
  );
}
