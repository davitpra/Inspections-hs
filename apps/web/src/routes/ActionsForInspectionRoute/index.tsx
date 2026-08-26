import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { useState } from 'react';

import { listActions } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { CheckIcon } from '../../components/icons';
import { ActionFilters } from './ActionFilters';
import { ActionsTable } from './ActionsTable';
import {
  inspectionGroupLabel,
  matchesInspectionGroup,
  siteOptions,
  sourceOptions,
  visibleActions,
  type ActionSiteFilter,
  type ActionSourceFilter,
  type ActionStatusFilter,
} from './presentation';

/**
 * Las acciones correctivas de UNA inspección (o de "Other sources", las que no
 * cuelgan de ninguna) — la vista que hoy vivía en `/actions` completa, ahora
 * acotada por `inspectionId` (§3 R3).
 *
 * Online y sin Dexie (design D15), igual que antes de acotarla: una acción se
 * ejecuta con red.
 */
export function ActionsForInspectionRoute(): React.JSX.Element {
  const { inspectionId } = useParams({ from: '/actions/inspection/$inspectionId' });
  const [status, setStatus] = useState<ActionStatusFilter>('active');
  const [source, setSource] = useState<ActionSourceFilter>('all');
  const [site, setSite] = useState<ActionSiteFilter>('all');
  const actions = useQuery({
    queryKey: queryKeys.actions(),
    queryFn: listActions,
    retry: false,
  });

  const all = actions.data ?? [];
  const group = all.filter((action) => matchesInspectionGroup(action, inspectionId));
  const rows = visibleActions(group, { status, source, site });
  const sources = sourceOptions(group);
  const sites = siteOptions(group);

  return (
    <>
      <Link to="/actions" className="back-link">
        Back to inspections
      </Link>

      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CheckIcon size={22} />
            </span>
            <h1>
              {inspectionGroupLabel(all, inspectionId)}{' '}
              {actions.isSuccess ? <span className="note">({rows.length})</span> : null}
            </h1>
          </div>
          <p className="scheduling__subtitle">
            Corrective actions for this inspection, ordered by the date they need attention.
          </p>
        </div>
      </header>

      {actions.isSuccess && group.length > 0 ? (
        <ActionFilters
          status={status}
          source={source}
          site={site}
          sources={sources}
          sites={sites}
          onStatus={setStatus}
          onSource={setSource}
          onSite={setSite}
        />
      ) : null}

      {actions.isError ? (
        <p className="notice">Corrective actions need a connection.</p>
      ) : null}

      {actions.isLoading ? <p>Loading corrective actions…</p> : null}

      {actions.isSuccess && group.length === 0 ? (
        <p>No corrective actions have been recorded for this inspection.</p>
      ) : null}

      {actions.isSuccess && group.length > 0 && rows.length === 0 ? (
        <p>No corrective actions match these filters.</p>
      ) : null}

      {rows.length > 0 ? <ActionsTable actions={rows} /> : null}
    </>
  );
}
