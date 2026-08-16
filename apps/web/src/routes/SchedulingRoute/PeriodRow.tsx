import { useState } from "react";
import type { ScheduledInspection } from "@hs/contracts";

import { CancelPeriodDialog } from "./CancelPeriodDialog";
import { CalendarIcon } from "../../components/icons";
import { monthName } from "../../presentation/dates";
import { ReopenPeriodDialog } from "./ReopenPeriodDialog";
import {
  inspectorLabel,
  isUnassigned,
  missedNote,
  statusClass,
  statusPillClass,
  STATUS_LABELS,
} from "./presentation";
import { PeriodControls } from "./PeriodControls";
import { PeriodMenu } from "./PeriodMenu";

/**
 * Un mes ya abierto: el encabezado dice qué es y cómo está, el cuerpo ofrece lo único
 * que se hace seguido —asignar—, y lo excepcional vive en el menú (ver `PeriodMenu`).
 *
 * La plantilla es el subtítulo del mes y no una línea suelta: las doce filas del año son
 * del mismo mes distinto y de la misma plantilla, así que lo que las distingue tiene que
 * leerse junto, en el bloque que el ojo usa para identificar la tarjeta.
 *
 * El diálogo de cancelación cuelga de acá y no de `PeriodControls`: al cancelar con éxito
 * la fila se redibuja con `cancelled_at` no nulo y los controles dejan de montarse, así
 * que el modal tiene que vivir en un nodo que sobreviva a la mutación.
 *
 * UN MES CANCELADO NO ES UN CALLEJÓN SIN SALIDA. La cancelación no se deshace —el trigger
 * de 0008 rechaza limpiar `cancelled_at`, y su HINT dice qué hacer en su lugar: programar
 * el período de nuevo—, así que el menú sigue estando cuando el mes está cancelado, con
 * esa única acción (`ReopenPeriodDialog`). Sin esto la obligación del mes quedaba muerta:
 * `projectYear` da la casilla por ocupada y la casilla no ofrecía nada.
 */
export function PeriodRow({
  inspection,
  siteId,
  canAdminister,
}: {
  inspection: ScheduledInspection;
  siteId: string;
  canAdminister: boolean;
}): React.JSX.Element {
  const [cancelling, setCancelling] = useState(false);
  const [reopening, setReopening] = useState(false);
  const cancelled = inspection.cancelled_at !== null;
  const administrable = canAdminister && !cancelled;
  const missed = missedNote(inspection);

  /**
   * Las dos son excepcionales y son excluyentes: un mes abierto se cancela, uno cancelado
   * se vuelve a programar. Quien no administra no tiene menú, porque no queda ninguna.
   */
  const actions = !canAdminister
    ? []
    : cancelled
      ? [{ label: 'Schedule this month again', onSelect: () => setReopening(true) }]
      : [
          {
            label: 'Cancel this period',
            tone: 'danger' as const,
            onSelect: () => setCancelling(true),
          },
        ];

  return (
    <li
      id={`period-${inspection.id}`}
      className={statusClass(inspection.status)}
    >
      {/* Fuera del flujo del encabezado: ancla en la esquina de la tarjeta, no una columna
          más del renglón, así el mes y su estado se acomodan sin contar con él. */}
      {actions.length > 0 ? (
        <PeriodMenu
          label={`More actions for ${monthName(inspection.period_start)}`}
          actions={actions}
        />
      ) : null}

      <div
        className={
          actions.length > 0 ? "period__head period__head--menu" : "period__head"
        }
      >
        <span className="period__icon">
          <CalendarIcon />
        </span>

        <span className="period__title">
          <span className="period__month">
            {monthName(inspection.period_start)}
          </span>
        </span>

        <span className="period__badges">
          <span className={statusPillClass(inspection.status)}>
            {STATUS_LABELS[inspection.status]}
          </span>
          {isUnassigned(inspection) ? (
            <span className="status-pill status-pill--unassigned">
              Unassigned
            </span>
          ) : null}
        </span>
      </div>
      <span className="period__status">{inspection.template_name}</span>

      {/* Quien no administra no tiene el selector, así que el inspector se lee acá. */}
      {administrable || isUnassigned(inspection) ? null : (
        <span className="period__note">{inspectorLabel(inspection)}</span>
      )}

      {inspection.cancellation_reason ? (
        <span className="period__note">
          Cancelled: {inspection.cancellation_reason}
        </span>
      ) : null}

      {/* La píldora dice el estado; esto dice qué se puede hacer con él (ver `missedNote`). */}
      {missed ? (
        <span className="period__note period__note--warn">{missed}</span>
      ) : null}

      {administrable ? (
        <PeriodControls inspection={inspection} siteId={siteId} />
      ) : null}

      {/* Montaje condicional: cada apertura crea el modal de nuevo y el motivo nace limpio. */}
      {cancelling ? (
        <CancelPeriodDialog
          inspection={inspection}
          onClose={() => setCancelling(false)}
        />
      ) : null}

      {reopening ? (
        <ReopenPeriodDialog
          inspection={inspection}
          siteId={siteId}
          onClose={() => setReopening(false)}
        />
      ) : null}
    </li>
  );
}
