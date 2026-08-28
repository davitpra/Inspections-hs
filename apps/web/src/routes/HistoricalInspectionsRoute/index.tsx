import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { listScheduled, listSites } from '../../api/inspections';
import { queryKeys } from '../../api/query-keys';
import { useAppSession } from '../../app/session-context';
import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { CalendarIcon } from '../../components/icons';
import { completedInspections } from '../../presentation/inspections';

/**
 * Todo lo que esta cuenta cerró, no solo lo último.
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

  const sites = useQuery({ queryKey: queryKeys.sites(), queryFn: listSites, retry: false });
  const scheduled = useQuery({
    queryKey: queryKeys.scheduledInspections(),
    queryFn: listScheduled,
    retry: false,
  });

  const siteName = (id: string): string =>
    sites.data?.find((site) => site.id === id)?.name ?? id;

  const completed = account ? completedInspections(scheduled.data ?? [], account.userId) : [];

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
            Every workplace inspection you have completed, most recent first.
          </p>
        </div>
      </header>

      <p>
        <Link className="back-link" to="/">
          Back to my inspections
        </Link>
      </p>

      {scheduled.isError ? (
        <p className="notice">
          Historical inspections need a connection. They are kept on the server, not on this
          device.
        </p>
      ) : null}

      {scheduled.isSuccess && completed.length === 0 ? (
        <p>You have not completed any inspections yet.</p>
      ) : null}

      {completed.length > 0 ? (
        <CompletedInspectionsTable inspections={completed} siteName={siteName} />
      ) : null}
    </>
  );
}
