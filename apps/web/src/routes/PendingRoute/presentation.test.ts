import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import {
  discardRefusalMessage,
  draftLabel,
  pendingWork,
  submittedFromDevice,
} from './presentation';

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

/**
 * El corte entre las dos secciones. Una inspección aceptada no es un borrador: no se
 * edita, no se descarta y no espera nada, y listarla bajo "Drafts on this device" hacía
 * que el encabezado mintiera sobre la mayoría de sus filas.
 */
describe('las dos listas de este dispositivo', () => {
  const drafts = [
    { status: 'capturing' as const },
    { status: 'signed' as const },
    { status: 'accepted' as const },
  ].map((partial, index) => ({
    client_submission_id: `draft-${index}`,
    scheduled_inspection_id: 'inspection-1',
    account_id: 'account-1',
    site_id: 'site-1',
    template_version_id: 'version-1',
    created_at: '2026-08-01T10:00:00.000Z',
    updated_at: '2026-08-01T10:00:00.000Z',
    current_item_key: null,
    signed_at: null,
    ...partial,
  }));

  it('lo que todavía pide trabajo excluye lo aceptado', () => {
    expect(pendingWork(drafts).map((draft) => draft.status)).toEqual(['capturing', 'signed']);
  });

  /** Y no desaparece: es el único acceso sin red a lo que ya se envió. */
  it('lo enviado se lista aparte, no se esconde', () => {
    expect(submittedFromDevice(drafts).map((draft) => draft.status)).toEqual(['accepted']);
  });
});
