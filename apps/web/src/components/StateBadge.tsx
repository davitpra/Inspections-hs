import type { ActionState } from '@hs/contracts';

import { STATE_LABELS } from '../routes/action-permissions';

/**
 * El estado de una acción correctiva, en palabras y no en un color.
 *
 * Sale del stream de eventos del servidor —no hay columna de estado que leer— y se
 * muestra tal cual: la UI no deriva ni reinterpreta nada.
 *
 * Compartido entre la lista de acciones y el detalle — el detalle lo importaba del
 * módulo de la lista, que es una ruta llamando a otra.
 */
export function StateBadge({ state }: { state: ActionState }): React.JSX.Element {
  return <span className={`badge badge--${state}`}>{STATE_LABELS[state]}</span>;
}
