import type { DraftRow } from '../../offline/db';
import { DiscardRefusedError, type DiscardRefusal } from '../../offline/drafts';
import type { PackageDrift } from '../../offline/prefetch';
import { formatInstant } from '../../presentation/dates';

/**
 * Los detalles que acompañan a la versión del paquete en la tira de datos.
 *
 * El sello de la descarga va ahí y no en el botón porque es lo que hace que volver a
 * bajar sea una decisión y no una apuesta. Sin sello se dice "Locked": la versión está
 * congelada igual, lo que falta es saber desde cuándo.
 *
 * Lo publicado se compara contra la versión a la que la inspección está ATADA, no contra
 * la que hay en el dispositivo: es un aviso de que hay algo más nuevo, no de deriva —de
 * eso se ocupa `driftMessage`.
 */
export function versionHints({
  fetchedAt,
  frozenVersion,
  latestVersion,
}: {
  fetchedAt: string | null | undefined;
  frozenVersion: number;
  latestVersion: number;
}): string[] {
  return [
    fetchedAt ? `Downloaded ${formatInstant(fetchedAt)}` : 'Locked',
    ...(latestVersion > frozenVersion ? [`Version ${latestVersion} is published`] : []),
  ];
}

export function driftMessage(
  drift: PackageDrift,
  draftStatus: DraftRow['status'] | null = null,
): string | null {
  if (drift === 'none') return null;

  if (drift === 'stale-package') {
    return 'The package on this device is not the version this inspection is locked to. Refresh it while you have a connection.';
  }

  if (drift === 'newer-version') {
    if (draftStatus === 'signed') {
      return 'A newer version of this form is published, but this signed draft cannot be discarded. The server will refuse it if the inspection advances.';
    }

    if (draftStatus === 'capturing') {
      return 'A newer version of this form is published. Discard this draft before refreshing to take it.';
    }

    return 'A newer version of this form is published. Refresh the package to take it.';
  }

  if (draftStatus === 'signed') {
    return 'This draft was started against a different version of the form. It is signed and on its way, and the server will refuse it.';
  }

  return 'This draft was started against a different version of the form and cannot be continued. Discard it and start the inspection over.';
}

/**
 * El borrador que todavía es trabajo: lo aceptado ya salió del dispositivo y no se
 * ofrece como borrador ni se descarta (ADR-001, el envío es el punto de no retorno).
 */
export function pendingDraft(draft: DraftRow | null): DraftRow | null {
  return draft === null || draft.status === 'accepted' ? null : draft;
}

export function draftPillClass(status: DraftRow['status']): string {
  if (status === 'accepted') return 'status-pill status-pill--completed';

  return status === 'signed'
    ? 'status-pill status-pill--signed'
    : 'status-pill status-pill--draft';
}

export function statusLabel(status: DraftRow['status']): string {
  if (status === 'accepted') return 'Submitted';
  if (status === 'signed') return 'Signed, waiting to send';

  return 'Draft';
}

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
