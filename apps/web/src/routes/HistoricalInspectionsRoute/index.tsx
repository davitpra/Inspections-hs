import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { CalendarIcon } from '../../components/icons';
import {
  completedInspections,
  inspectionTypeGroups,
  templateNamePhrase,
} from '../../presentation/inspections';

/**
 * Todo lo que esta cuenta cerró, separado por la identidad estable de cada plantilla.
 *
 * Lee con la MISMA consulta y la MISMA clave que la pantalla de inicio, así que llegar acá
 * desde su cabecera no cuesta una llamada: es la caché ya tibia, leída con otro filtro.
 *
 * De servidor y sin reintento, como el resto de lo que se lista acá: el historial no es
 * trabajo en curso y no tiene por qué estar en el dispositivo. ADR-010 presupone el
 * almacenamiento local para lo que está en vuelo —siete días—, no para un archivo que
 * crece solo.
 */
export function HistoricalInspectionsRoute(): React.JSX.Element {
  const { account } = useAppSession();

  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });
  const sites = useQuery({
    queryKey: queryKeys.sites(),
    queryFn: listSites,
    retry: false,
  });

  const completed = account
    ? completedInspections(scheduled.data ?? [], account.userId)
    : [];
  const types = inspectionTypeGroups(completed);
  const loaded = scheduled.isSuccess && sites.isSuccess;
  const failed = scheduled.isError || sites.isError;
  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  return (
    <>
      <header className="scheduling__top">
        <div className="scheduling__header">
          <div className="scheduling__title">
            <span className="scheduling__icon">
              <CalendarIcon size={22} />
            </span>
            <h1>Historical inspections</h1>
          </div>
          <p className="scheduling__subtitle">
            Review every inspection you completed, grouped by inspection type.
          </p>
        </div>
      </header>

      <p>
        <Link className="back-link" to="/">
          Back to my inspections
        </Link>
      </p>

      {failed ? (
        <p className="notice">
          Historical inspections need a connection. They are kept on the server,
          not on this device.
        </p>
      ) : null}

      {!failed && !loaded ? (
        <p className="status-card">Loading historical inspections…</p>
      ) : null}

      {loaded && completed.length === 0 ? (
        <p>You have not completed any inspections yet.</p>
      ) : null}

      {loaded && types.length > 0 ? (
        <div className="inspection-groups">
          {types.map((group) => {
            const headingId = `historical-type-${group.templateId}`;

            return (
              <section
                key={group.templateId}
                className="inspection-group"
                aria-labelledby={headingId}
              >
                <div className="inspection-group__head">
                  <h2 id={headingId}>
                    {group.templateName}
                    <span className="inspection-group__count">
                      {` (${group.inspections.length})`}
                    </span>
                  </h2>
                  <p className="inspection-group__blurb">
                    All completed {templateNamePhrase(group.templateName)}.
                  </p>
                </div>
                <CompletedInspectionsTable
                  inspections={group.inspections}
                  siteName={siteName}
                  to="/inspections/$id/report"
                  actionLabel="View report"
                  ariaLabel={`${group.templateName} completed inspections`}
                />
              </section>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
