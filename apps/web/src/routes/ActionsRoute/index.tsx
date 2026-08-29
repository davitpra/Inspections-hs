import { useQuery } from '@tanstack/react-query';

import { listActions } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { AlertCircleIcon, CheckCircleIcon, CheckIcon, ListIcon } from '../../components/icons';
import { InspectionsTable } from './InspectionsTable';
import { groupActionsByInspection } from './presentation';

/**
 * Las inspecciones de las plantas del alcance que tienen alguna acción correctiva
 * pendiente o cerrada (§3 R3), agrupadas por inspección. Es el punto de entrada:
 * de acá se abre la tabla plana de acciones de UNA inspección
 * (`ActionsForInspectionRoute`, en `/actions/inspection/$inspectionId`).
 *
 * Online y sin Dexie (design D15), por el mismo motivo que la tabla que agrupa:
 * una acción se ejecuta con red.
 *
 * Las acciones que no cuelgan de ninguna inspección (manual finding, investigación)
 * se juntan en un solo grupo, "Other sources", en vez de perderse de esta pantalla.
 *
 * **ACÁ YA NO SE CREAN ACCIONES, Y ESA AUSENCIA ES EL DISEÑO.** Un compromiso se abre donde
 * el hallazgo se lee —`/findings/$id`, junto a la pregunta que lo abrió y a lo que la
 * plantilla prescribió—, no desde una fila de tabla que solo trae la descripción. Esta
 * pantalla quedó dedicada a un solo recurso: las acciones que ya existen.
 */
export function ActionsRoute(): React.JSX.Element {
  const actions = useQuery({
    queryKey: queryKeys.actions(),
    queryFn: listActions,
    retry: false,
  });

  const all = actions.data ?? [];
  const groups = groupActionsByInspection(all);
  const activeCount = all.filter((action) => action.state !== 'closed').length;
  const overdueCount = all.filter(
    (action) => action.overdue && action.state !== 'closed',
  ).length;

  return (
    <div className="actions-overview">
      <header className="actions-overview__hero">
        <div className="actions-overview__intro">
          <div className="actions-overview__title">
            <span className="actions-overview__title-icon">
              <CheckIcon size={22} />
            </span>
            <div>
              <p className="actions-overview__eyebrow">Safety follow-through</p>
              <h1>Corrective actions</h1>
            </div>
          </div>
          <p className="actions-overview__subtitle">
            Every commitment already opened, grouped by the inspection it came from. New ones
            are opened from the finding that justifies them.
          </p>
        </div>

        <dl className="actions-overview__stats" aria-label="Corrective action summary">
          <div className="actions-overview__stat">
            <dt><ListIcon size={17} /> Total actions</dt>
            <dd>{actions.isSuccess ? all.length : '—'}</dd>
          </div>
          <div className="actions-overview__stat">
            <dt><CheckCircleIcon size={17} /> Active</dt>
            <dd>{actions.isSuccess ? activeCount : '—'}</dd>
          </div>
          <div className="actions-overview__stat actions-overview__stat--warn">
            <dt><AlertCircleIcon size={17} /> Overdue</dt>
            <dd>{actions.isSuccess ? overdueCount : '—'}</dd>
          </div>
          <div className="actions-overview__stat">
            <dt>Inspection groups</dt>
            <dd>{actions.isSuccess ? groups.length : '—'}</dd>
          </div>
        </dl>
      </header>

      <section className="card actions-overview__section" aria-labelledby="existing-actions-heading">
        <div className="actions-overview__section-head">
          <div>
            <p className="actions-overview__eyebrow">Work in progress</p>
            <h2 id="existing-actions-heading">Existing corrective actions</h2>
            <p>Open an inspection to review its commitments and move work forward.</p>
          </div>
          {actions.isSuccess ? (
            <span className="actions-overview__count">{groups.length} {groups.length === 1 ? 'group' : 'groups'}</span>
          ) : null}
        </div>

        {actions.isError ? (
          <p className="status-card status-card--error">
            <AlertCircleIcon size={20} /> Corrective actions need a connection.
          </p>
        ) : null}

        {actions.isLoading ? (
          <p className="status-card"><ListIcon size={20} /> Loading corrective actions…</p>
        ) : null}

        {actions.isSuccess && groups.length === 0 ? (
          <div className="actions-overview__empty">
            <span className="actions-overview__empty-icon"><CheckCircleIcon size={24} /></span>
            <strong>No corrective actions yet</strong>
            <p>No corrective actions have been recorded for your sites.</p>
          </div>
        ) : null}

        {groups.length > 0 ? <InspectionsTable groups={groups} /> : null}
      </section>
    </div>
  );
}
