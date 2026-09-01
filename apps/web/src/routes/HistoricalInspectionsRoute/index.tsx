import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { listScheduled } from "../../api/inspections";
import { queryKeys } from "../../api/query-keys";
import { useAppSession } from "../../app/session-context";
import { InspectionTypeIndexTable } from "../../components/InspectionTypeIndexTable";
import { CalendarIcon } from "../../components/icons";
import {
  completedInspections,
  inspectionTypeGroups,
} from "../../presentation/inspections";

/**
 * Los tipos de inspección que esta cuenta cerró, como entrada a cada historial completo.
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

  const completed = account
    ? completedInspections(scheduled.data ?? [], account.userId)
    : [];
  const types = inspectionTypeGroups(completed);

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
            Choose an inspection type to read everything you completed.
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
          Historical inspections need a connection. They are kept on the server,
          not on this device.
        </p>
      ) : null}

      {scheduled.isLoading ? (
        <p className="status-card">Loading historical inspections…</p>
      ) : null}

      {scheduled.isSuccess && completed.length === 0 ? (
        <p>You have not completed any inspections yet.</p>
      ) : null}

      {types.length > 0 ? (
        <InspectionTypeIndexTable
          groups={types}
          to="/historical/$templateId"
          ariaLabel="Completed inspection types"
          countLabel="Completed inspections"
        />
      ) : null}
    </>
  );
}
