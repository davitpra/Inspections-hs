import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import { discardRefusalMessage, draftLabel } from './presentation';

describe('draftLabel', () => {
  it('no llama "submitted" a lo que todavía no salió del dispositivo', () => {
    expect(draftLabel({ status: 'capturing', created_at: '2026-08-01T10:00:00.000Z' })).toBe(
      'Draft — started 2026-08-01',
    );
    expect(draftLabel({ status: 'signed', created_at: '2026-08-01T10:00:00.000Z' })).toBe(
      'Signed, waiting to send — started 2026-08-01',
    );
    expect(draftLabel({ status: 'accepted', created_at: '2026-08-01T10:00:00.000Z' })).toBe(
      'Submitted — started 2026-08-01',
    );
  });
});

describe('discardRefusalMessage', () => {
  it('dice dónde quedó el borrador en cada motivo', () => {
    expect(discardRefusalMessage(new DiscardRefusedError('not_owner'))).toMatch(
      /another account/,
    );
    expect(discardRefusalMessage(new DiscardRefusedError('already_signed'))).toMatch(
      /on its way/,
    );
    expect(discardRefusalMessage(new DiscardRefusedError('already_queued'))).toMatch(
      /on its way/,
    );
  });

  /** Un error que no es de descarte igual tiene que decir que la inspección sigue ahí. */
  it('un error inesperado no sugiere que se borró', () => {
    expect(discardRefusalMessage(new Error('boom'))).toMatch(/still on this device/);
  });
});
