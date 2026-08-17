import type { PendingInspection } from '@hs/contracts';
import { countAnsweredBySection } from '@hs/forms';
import { useQuery } from '@tanstack/react-query';

import { queryKeys } from '../../api/query-keys';
import { readableKind } from '../../components/FieldPackage';
import { InfoIcon } from '../../components/icons';
import type { DraftRow } from '../../offline/db';
import { loadDraft } from '../../offline/drafts';
import { missingForField, storedTemplateVersion } from '../../offline/prefetch';
import { readiness } from './presentation';

/**
 * El progreso de la asignación destacada, leído SOLO del dispositivo.
 *
 * La misma consulta `fieldReady` que `PendingRow` y `AssignmentHero` decide si hay algo
 * que mostrar: sin paquete no hay progreso posible — la tarjeta ES la llamada a
 * descargar, con el mismo mensaje que nombra lo que falta, no un 0% sobre un documento
 * que no está.
 */
export function AssignmentChecklist({
  inspection,
  draft,
}: {
  inspection: PendingInspection;
  draft: DraftRow | null;
}): React.JSX.Element {
  const missing = useQuery({
    queryKey: queryKeys.fieldReady(inspection.id),
    queryFn: () => missingForField(inspection.id),
  });

  const state = readiness(missing.data);

  const stored = useQuery({
    queryKey: queryKeys.storedTemplateVersion(inspection.id),
    queryFn: () => storedTemplateVersion(inspection.id),
    enabled: state === 'ready',
  });

  const loaded = useQuery({
    queryKey: queryKeys.draft(inspection.id, draft?.account_id),
    enabled: Boolean(draft) && state === 'ready',
    queryFn: () => (draft ? loadDraft(draft.client_submission_id) : null),
  });

  if (state === 'unknown') {
    return (
      <p className="status-card">
        <InfoIcon size={20} /> Loading…
      </p>
    );
  }

  if (state === 'not-ready') {
    return (
      <div className="card">
        <h3>Inspection progress</h3>
        <p className="period__note period__note--warn">
          Not ready — missing {(missing.data ?? []).map(readableKind).join(', ')}
        </p>
        <p className="progress__text">Use "Download for the field" above to get it ready.</p>
      </div>
    );
  }

  if (!stored.data) {
    return (
      <p className="status-card">
        <InfoIcon size={20} /> Loading…
      </p>
    );
  }

  const answers = loaded.data?.answers ?? {};
  const sections = countAnsweredBySection(stored.data.document, answers);
  const answered = sections.reduce((sum, section) => sum + section.answered, 0);
  const total = sections.reduce((sum, section) => sum + section.total, 0);
  const percent = total === 0 ? 0 : Math.round((answered / total) * 100);

  return (
    <div className="card">
      <h3>Inspection progress</h3>

      <div className="progress">
        <div
          className="progress-ring"
          style={{ background: `conic-gradient(var(--brand) ${percent}%, var(--line) 0)` }}
        >
          <span className="progress-ring__value">{percent}%</span>
        </div>

        <div>
          <p className="progress__title">
            {answered === 0
              ? "Let's get started"
              : answered === total
                ? 'All set'
                : 'In progress'}
          </p>
          <p className="progress__text">
            {answered} of {total} items completed
          </p>
        </div>
      </div>

      <h3>Inspection sections</h3>

      <ul className="grid--list">
        {sections.map((section) => (
          <li key={section.section_key} className="section-row">
            <span className="section-row__title">{section.section_title}</span>
            <span className="section-row__count">
              {section.answered} / {section.total} items
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
