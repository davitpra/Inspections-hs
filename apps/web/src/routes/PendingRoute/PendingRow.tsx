import type { PendingInspection } from '@hs/contracts';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';

import { queryKeys } from '../../api/query-keys';
import { DownloadForField, readableKind } from '../../components/FieldPackage';
import { CalendarIcon } from '../../components/icons';
import { missingForField } from '../../offline/prefetch';
import { monthName } from '../../presentation/dates';
import { pendingCardClass, readiness } from './presentation';

/**
 * Una inspección programada, con la única acción que corresponde a su estado.
 *
 * La tarjeta es la misma que el calendario del coordinador (`SchedulingRoute/PeriodRow`):
 * el mes grande arriba, la plantilla como su subtítulo, el estado en píldoras contra el
 * borde derecho y la acción a lo ancho al pie. Para el inspector el mes es el dato que
 * identifica la obligación —"la de marzo"—, y en la fila corrida iba incrustado en medio
 * de una frase.
 */
export function PendingRow({
  inspection,
}: {
  inspection: PendingInspection;
}): React.JSX.Element {
  const missing = useQuery({
    queryKey: queryKeys.fieldReady(inspection.id),
    queryFn: () => missingForField(inspection.id),
  });

  const state = readiness(missing.data);

  return (
    <li className={pendingCardClass(state, inspection.overdue)}>
      <div className="period__head">
        <span className="period__icon">
          <CalendarIcon />
        </span>

        <span className="period__title">
          <span className="period__month">{monthName(inspection.period_start)}</span>
          <span className="period__status">{inspection.template_name}</span>
        </span>

        <span className="period__badges">
          {inspection.overdue ? (
            <span className="status-pill status-pill--overdue">Overdue</span>
          ) : null}

          {state === 'ready' ? (
            <span className="status-pill status-pill--ready">Ready for the field</span>
          ) : null}
        </span>
      </div>

      {/*
       * Lo que falta se NOMBRA, y fuera de la píldora: un booleano en rojo no le dice al
       * inspector qué hacer, y la lista de piezas no entra en una píldora sin partirse.
       */}
      {state === 'not-ready' ? (
        <span className="period__note period__note--warn">
          Not ready — missing {(missing.data ?? []).map(readableKind).join(', ')}
        </span>
      ) : null}

      {/*
       * Una sola acción por tarjeta, y es la que corresponde al estado: bajar el paquete, o
       * empezar. Mientras la consulta no resolvió no se ofrece ninguna — un botón de
       * empezar que aparece antes de saber si hay documento manda al inspector a una
       * pantalla que lo va a rechazar.
       */}
      {state === 'ready' ? (
        <Link
          to="/inspections/$id/capture"
          params={{ id: inspection.id }}
          className="list__action period__action"
        >
          Start inspection
        </Link>
      ) : null}

      {state === 'not-ready' ? <DownloadForField id={inspection.id} /> : null}
    </li>
  );
}
