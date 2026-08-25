import type { DraftRow } from '../../offline/db';
import type { PackageDrift } from '../../offline/prefetch';

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
