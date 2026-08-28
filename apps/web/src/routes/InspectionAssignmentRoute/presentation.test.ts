import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import {
  discardRefusalMessage,
  driftMessage,
  pendingDraft,
  statusLabel,
  versionHints,
} from './presentation';

function draft(status: 'capturing' | 'signed' | 'accepted') {
  return {
    client_submission_id: `draft-${status}`,
    scheduled_inspection_id: '11111111-1111-4111-8111-111111111111',
    account_id: 'account-1',
    site_id: 'site-1',
    template_version_id: 'version-1',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    current_item_key: null,
    status,
    signed_at: null,
  };
}

describe('driftMessage', () => {
  it('sin deriva no dice nada', () => {
    expect(driftMessage('none')).toBeNull();
  });

  it('un paquete rancio manda a refrescar', () => {
    expect(driftMessage('stale-package')).toContain('Refresh it');
  });

  it('un borrador huérfano distingue si todavía puede descartarse', () => {
    expect(driftMessage('draft-orphaned', 'capturing')).toContain('Discard it');
    const signed = driftMessage('draft-orphaned', 'signed');
    expect(signed).not.toContain('Discard it');
    expect(signed).toContain('server will refuse it');
  });

  it('una versión nueva distingue el estado del borrador', () => {
    expect(driftMessage('newer-version')).toContain('Refresh the package');
    expect(driftMessage('newer-version', 'capturing')).toContain('Discard this draft');
    expect(driftMessage('newer-version', 'signed')).toContain('server will refuse it');
  });
});

describe('versionHints', () => {
  it('sella la descarga con la hora guardada, sin pasar por el huso del dispositivo', () => {
    expect(
      versionHints({
        fetchedAt: '2026-08-20T23:45:12.000Z',
        frozenVersion: 3,
        latestVersion: 3,
      }),
    ).toEqual(['Downloaded 2026-08-20 23:45']);
  });

  it('sin sello dice que está congelada igual', () => {
    expect(versionHints({ fetchedAt: null, frozenVersion: 3, latestVersion: 3 })).toEqual([
      'Locked',
    ]);
  });

  it('avisa de lo publicado sin desplazar al sello', () => {
    expect(
      versionHints({ fetchedAt: undefined, frozenVersion: 3, latestVersion: 5 }),
    ).toEqual(['Locked', 'Version 5 is published']);
  });
});

describe('presentación del borrador local', () => {
  it('excluye lo aceptado y nombra cada estado sin llamar submitted a lo firmado', () => {
    expect(pendingDraft(draft('capturing'))?.status).toBe('capturing');
    expect(pendingDraft(draft('signed'))?.status).toBe('signed');
    expect(pendingDraft(draft('accepted'))).toBeNull();
    expect(pendingDraft(null)).toBeNull();
    expect(statusLabel('capturing')).toBe('Draft');
    expect(statusLabel('signed')).toBe('Signed, waiting to send');
    expect(statusLabel('accepted')).toBe('Submitted');
  });

  it('explica que un descarte rechazado conserva el borrador', () => {
    expect(discardRefusalMessage(new DiscardRefusedError('not_owner'))).toMatch(/another account/);
    expect(discardRefusalMessage(new DiscardRefusedError('already_queued'))).toMatch(/on its way/);
    expect(discardRefusalMessage(new Error('boom'))).toMatch(/still on this device/);
  });
});
