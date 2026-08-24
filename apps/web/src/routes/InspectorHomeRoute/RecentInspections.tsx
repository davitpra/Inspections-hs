import type { ScheduledInspection } from '@hs/contracts';
import { Link } from '@tanstack/react-router';

import { CompletedInspectionsTable } from '../../components/CompletedInspectionsTable';
import { recentCompleted } from '../../presentation/inspections';

/**
 * Lo último que este inspector cerró, con la fecha en que lo cerró, y la salida hacia el
 * historial completo.
 *
 * Es un recorte de la MISMA lista que dibuja `/inspections/past`, con la misma tabla: acá
 * entran las últimas tres para que la pantalla de inicio tenga historia sin volverse un
 * archivo.
 */
export function RecentInspections({
  scheduled,
  userId,
  siteName,
}: {
  scheduled: readonly ScheduledInspection[];
  userId: string;
  siteName: (id: string) => string;
}): React.JSX.Element | null {
  const recent = recentCompleted(scheduled, userId);

  if (recent.length === 0) return null;

  return (
    <div className="card">
      <div className="card__head">
        <h3>Recent inspections</h3>
      </div>

      <CompletedInspectionsTable inspections={recent} siteName={siteName} />

      <div className="card__footer">
        <Link to="/inspections/past" className="list__action list__action--block">
          View all past inspections →
        </Link>
      </div>
    </div>
  );
}
