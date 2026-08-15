import type { DraftRow } from '../../offline/db';
import { DiscardRefusedError, type DiscardRefusal } from '../../offline/drafts';

/**
 * Cómo se lee un borrador en la lista, y qué se le puede hacer.
 *
 * Es lógica pura y vive acá porque decide algo que importa: qué fila ofrece descartar.
 * `isDiscardable` de `offline/drafts.ts` es la regla de la escritura —la que de verdad
 * impide borrar— y esto es la de la pantalla, que solo decide qué se dibuja. Las dos
 * dicen lo mismo a propósito: una fila que ofreciera un botón que la base va a rechazar
 * sería una promesa rota, y una que lo escondiera dejaría al inspector sin salida.
 */
export function draftLabel(draft: Pick<DraftRow, 'status' | 'created_at'>): string {
  return `${statusLabel(draft.status)} — started ${draft.created_at.slice(0, 10)}`;
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

function statusLabel(status: DraftRow['status']): string {
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
