import type { PendingInspection } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { DownloadForField, readableKind } from '../../components/FieldPackage';
import { missingForField } from '../../offline/prefetch';

/** Una inspección programada, con la única acción que corresponde a su estado. */
export function PendingRow({
  inspection,
}: {
  inspection: PendingInspection;
}): React.JSX.Element {
  const missing = useQuery({
    queryKey: queryKeys.fieldReady(inspection.id),
    queryFn: () => missingForField(inspection.id),
  });

  const ready = missing.data?.length === 0;

  return (
    <li className="list__row">
      <span>
        {inspection.template_name} — {inspection.period_start.slice(0, 7)}
      </span>

      {inspection.overdue ? <span className="badge badge--overdue">Overdue</span> : null}

      {/*
       * Una sola acción por fila, y es la que corresponde al estado: bajar el paquete, o
       * empezar. Mientras la consulta no resolvió no se ofrece ninguna — un botón de
       * empezar que aparece antes de saber si hay documento manda al inspector a una
       * pantalla que lo va a rechazar.
       */}
      {missing.isSuccess ? (
        ready ? (
          <>
            <span className="badge badge--ready">Ready for the field</span>
            <Link
              to="/inspections/$id/capture"
              params={{ id: inspection.id }}
              className="list__action"
            >
              Start inspection
            </Link>
          </>
        ) : (
          <>
            {/*
             * Lo que falta se NOMBRA. Un booleano en rojo no le dice al inspector qué
             * hacer; "roster" sí.
             */}
            <span className="badge badge--missing">
              Not ready — missing {missing.data.map(readableKind).join(', ')}
            </span>
            <DownloadForField id={inspection.id} />
          </>
        )
      ) : null}
    </li>
  );
}
