import { useQuery } from '@tanstack/react-query';

import { listActions } from '../../api/actions';
import { queryKeys } from '../../api/query-keys';
import { CheckIcon } from '../../components/icons';
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
 */
export function ActionsRoute(): React.JSX.Element {
  const actions = useQuery({
    queryKey: queryKeys.actions(),
    queryFn: listActions,
    retry: false,
  });

  const all = actions.data ?? [];
  const groups = groupActionsByInspection(all);

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CheckIcon size={22} />
            </span>
            <h1>
              Corrective actions{' '}
              {actions.isSuccess ? <span className="note">({groups.length})</span> : null}
            </h1>
          </div>
          <p className="scheduling__subtitle">
            Inspections with corrective actions for your sites. Open one to see its actions.
          </p>
        </div>
      </header>

      {actions.isError ? (
        <p className="notice">Corrective actions need a connection.</p>
      ) : null}

      {actions.isLoading ? <p>Loading corrective actions…</p> : null}

      {actions.isSuccess && groups.length === 0 ? (
        <p>No corrective actions have been recorded for your sites.</p>
      ) : null}

      {groups.length > 0 ? <InspectionsTable groups={groups} /> : null}
    </>
  );
}
