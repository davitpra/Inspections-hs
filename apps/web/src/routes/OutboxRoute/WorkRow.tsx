import { Link } from '@tanstack/react-router';

import type { DraftRow } from '../../offline/db';
import { isDiscardable } from '../../offline/drafts';
import type { DeviceWork } from '../../offline/outbox';
import { formatCivilDay } from '../../presentation/dates';
import { attemptsLabel, statePillClass, stateLabel } from './presentation';

/**
 * Una fila de lo que no salió de este dispositivo.
 *
 * Se separa de `index.tsx` porque la fila dejó de ser una sola forma: lo que está en la
 * cola se lee y se espera, y lo que todavía no se firmó se retoma o se descarta. Meter la
 * segunda mitad en el `map` de la lista mezclaba dos decisiones en un JSX que ya no cabía.
 *
 * Se lee de arriba abajo (`.list__row--stacked`): el estado, cuándo se empezó, el motivo
 * del servidor si lo hay, y la salida. En fila las tres cosas se mezclan en un párrafo, y
 * el motivo del rechazo es justo lo que hay que poder leer de un vistazo con el teléfono
 * en una mano.
 */
export function WorkRow({
  entry,
  onDiscard,
}: {
  entry: DeviceWork;
  onDiscard: (draft: DraftRow) => void;
}): React.JSX.Element {
  const { draft, row } = entry;
  const attempts = attemptsLabel(row?.attempts ?? null);

  return (
    <li className="list__row list__row--stacked">
      <p className="outbox__row-head">
        <span className={statePillClass(row?.state ?? null)}>
          {stateLabel(row?.state ?? null)}
        </span>
        {attempts ? <span className="list__aside">{attempts}</span> : null}
      </p>

      {/*
        «Started» a secas y no «Signed work started»: desde que la lista incluye lo que
        todavía no se firmó, esa línea era falsa en la mitad de las filas. Qué clase de
        trabajo es ya lo dice la píldora de arriba, y repetirlo acá solo daba lugar a que
        las dos se contradijeran.
      */}
      <p className="list__aside">Started {formatCivilDay(draft.created_at)}</p>

      {row?.last_error ? <p className="notice notice--warn">{row.last_error}</p> : null}

      {/*
        El borrador sigue legible en el dispositivo, incluso rechazado. Es trabajo que hay
        que arreglar, no trabajo que se tira.

        El link va a la asignación y no directo a la captura: la inspección puede haber
        dejado de existir del lado del servidor —cancelada, reasignada, o una base que se
        rehízo— y esa página lo dice con todas las letras en vez de abrir un recorrido
        contra un paquete que no está. Cuando sí existe, es un clic de más y el mismo
        destino.
      */}
      <p className="outbox__row-actions">
        <Link
          to="/inspections/$id"
          params={{ id: draft.scheduled_inspection_id }}
          className="list__action"
        >
          Open the inspection
        </Link>

        {/*
          Descartar solo existe en lo que todavía no salió (ADR-001: el envío es el punto
          de no retorno). Y existe ACÁ porque ésta puede ser la única puerta: si la
          inspección ya no vuelve del servidor, la página de la asignación no dibuja su
          tabla de borradores y el trabajo queda contado por el indicador para siempre.
        */}
        {isDiscardable(draft) ? (
          <button
            type="button"
            className="button--danger-quiet"
            onClick={() => onDiscard(draft)}
          >
            Discard draft
          </button>
        ) : null}
      </p>
    </li>
  );
}
