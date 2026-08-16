import type { PendingInspection } from '@hs/contracts';

import type { DraftRow } from '../../offline/db';
import { DiscardRefusedError, type DiscardRefusal } from '../../offline/drafts';
import { currentCivilYear } from '../../presentation/dates';

/**
 * Cómo se lee un borrador en la lista, y qué se le puede hacer.
 *
 * Es lógica pura y vive acá porque decide algo que importa: qué fila ofrece descartar.
 * `isDiscardable` de `offline/drafts.ts` es la regla de la escritura —la que de verdad
 * impide borrar— y esto es la de la pantalla, que solo decide qué se dibuja. Las dos
 * dicen lo mismo a propósito: una fila que ofreciera un botón que la base va a rechazar
 * sería una promesa rota, y una que lo escondiera dejaría al inspector sin salida.
 */
/**
 * El mes del período de un borrador, cuando se puede saber.
 *
 * El borrador guarda `scheduled_inspection_id` pero no `period_start`: el mes hay que
 * resolverlo contra la lista del servidor. Un borrador ya aceptado salió de esa lista, y
 * uno hecho sin red puede no tenerla todavía, así que esto devuelve `null` seguido y la
 * tarjeta cae a la fecha en que se empezó. Inventar un mes sería peor que no mostrarlo:
 * el mes es lo que identifica la obligación ante el regulador.
 */
export function draftPeriodStart(
  draft: Pick<DraftRow, 'scheduled_inspection_id'>,
  pending: readonly PendingInspection[],
): string | null {
  return (
    pending.find((item) => item.id === draft.scheduled_inspection_id)?.period_start ?? null
  );
}

/**
 * Si el paquete de campo está listo, todavía no, o no se sabe.
 *
 * `unknown` es la consulta sin resolver y NO es un caso de borde decorativo: es el que
 * hace que la tarjeta no ofrezca ninguna acción. Un botón de empezar dibujado antes de
 * saber si el documento está en el dispositivo manda al inspector a una pantalla que lo
 * va a rechazar, y eso se descubre en la planta, sin red y sin arreglo.
 */
export type Readiness = 'ready' | 'not-ready' | 'unknown';

export function readiness(missing: readonly string[] | undefined): Readiness {
  if (missing === undefined) return 'unknown';

  return missing.length === 0 ? 'ready' : 'not-ready';
}

/**
 * La clase de la tarjeta y la de su píldora. Son las mismas del calendario del
 * coordinador a propósito: si el mismo estado se dibujara distinto en las dos pantallas,
 * dejaría de significar lo mismo.
 *
 * Lo vencido gana sobre la disponibilidad del paquete: un mes que cerró sin inspección es
 * lo que hay que resolver primero, y descargar el formulario no cambia eso.
 */
export function pendingCardClass(state: Readiness, overdue: boolean): string {
  if (overdue) return 'period period--missed';

  return state === 'not-ready' ? 'period period--not-ready' : 'period period--open';
}

export function draftCardClass(status: DraftRow['status']): string {
  return status === 'accepted' ? 'period period--completed' : 'period period--open';
}

export function draftPillClass(status: DraftRow['status']): string {
  if (status === 'accepted') return 'status-pill status-pill--completed';

  return status === 'signed'
    ? 'status-pill status-pill--signed'
    : 'status-pill status-pill--draft';
}

/** Los meses pendientes de un año, en orden — la grilla se lee de enero a diciembre. */
export function pendingOfYear(
  pending: readonly PendingInspection[],
  year: string,
): PendingInspection[] {
  return pending
    .filter((item) => item.period_start.slice(0, 4) === year)
    .sort((a, b) => a.period_start.localeCompare(b.period_start));
}

/**
 * El año más antiguo al que la navegación deja retroceder: el del pendiente más viejo, o
 * el que se está mirando si no hay ninguno más atrás. Hacia adelante no hay tope, igual
 * que en la consola de programación.
 */
export function earliestPendingYear(
  pending: readonly PendingInspection[],
  currentYear: string,
): string {
  return [currentYear, ...pending.map((item) => item.period_start.slice(0, 4))].reduce(
    (earliest, year) => (year < earliest ? year : earliest),
  );
}

/**
 * El año con el que ABRE la pantalla, y por qué no es simplemente el año en curso.
 *
 * Esta es la pantalla de inicio del inspector. Si todo lo que debe es de diciembre pasado
 * y hoy es enero, abrir en el año civil la deja vacía y el inspector concluye que no debe
 * nada — con las inspecciones vencidas a un clic de distancia que nunca va a dar. Así que
 * el año en curso solo gana cuando tiene algo; si no, manda el pendiente más antiguo, que
 * es lo más urgente que hay.
 */
export function initialYear(
  pending: readonly PendingInspection[],
  now: Date = new Date(),
): string {
  const thisYear = currentCivilYear(now);

  if (pending.length === 0) return thisYear;
  if (pending.some((item) => item.period_start.slice(0, 4) === thisYear)) return thisYear;

  return earliestPendingYear(pending, thisYear);
}

/** Los conteos del pie: en qué estado están los meses del año que se está mirando. */
export interface PendingStats {
  total: number;
  ready: number;
  notReady: number;
  overdue: number;
}

export function pendingStats(
  entries: readonly { overdue: boolean; state: Readiness }[],
): PendingStats {
  return {
    total: entries.length,
    ready: entries.filter((entry) => entry.state === 'ready').length,
    notReady: entries.filter((entry) => entry.state === 'not-ready').length,
    overdue: entries.filter((entry) => entry.overdue).length,
  };
}

/**
 * La lista se parte en dos por el estado, y el corte es "¿queda algo por hacer acá?".
 *
 * `accepted` no es un borrador: el servidor ya lo tiene, no se puede editar, no se puede
 * descartar y no espera nada. Listarlo bajo "Drafts on this device" hacía que el título
 * mintiera sobre la mayoría de sus filas —una pantalla con ocho "Submitted" bajo el
 * encabezado de borradores— y enterraba las dos que sí pedían trabajo.
 *
 * Y no desaparece: sigue abriéndose de solo lectura, que es el único acceso que el
 * inspector tiene a lo que envió cuando no hay red. Por eso son dos secciones y no un
 * filtro: esconderlo resolvería el título rompiendo esa lectura.
 */
export function pendingWork(drafts: DraftRow[]): DraftRow[] {
  return drafts.filter((draft) => draft.status !== 'accepted');
}

export function submittedFromDevice(drafts: DraftRow[]): DraftRow[] {
  return drafts.filter((draft) => draft.status === 'accepted');
}

/**
 * Por qué no se pudo descartar, en inglés y diciendo dónde quedó el borrador.
 *
 * Cada motivo termina en lo mismo: la inspección sigue en el dispositivo. Es lo único
 * que el inspector necesita saber para no volver a intentarlo creyendo que se perdió.
 */
export function discardRefusalMessage(error: unknown): string {
  const reason: DiscardRefusal | 'unknown' =
    error instanceof DiscardRefusedError ? error.reason : 'unknown';

  switch (reason) {
    case 'not_owner':
      return 'This draft belongs to another account on this device. Sign in as its owner to discard it.';
    case 'already_signed':
    case 'already_queued':
      return 'This inspection is signed and waiting to be sent. It cannot be discarded — it is on its way.';
    default:
      return 'The draft could not be discarded. It is still on this device.';
  }
}

export function statusLabel(status: DraftRow['status']): string {
  /**
   * `signed` se nombra distinto de `capturing` y no se lo llama "Submitted": está
   * firmado y esperando en el outbox, que no es lo mismo que aceptado. El inspector que
   * lee "Submitted" en algo que todavía no salió del dispositivo cierra la aplicación
   * creyendo que terminó.
   */
  if (status === 'accepted') return 'Submitted';
  if (status === 'signed') return 'Signed, waiting to send';

  return 'Draft';
}
