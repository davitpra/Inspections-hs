import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import {
  discardRefusalMessage,
  draftPeriodStart,
  pendingWork,
  scheduledInspectionRows,
  statusLabel,
} from './presentation';

function inspection(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    site_id: '22222222-2222-4222-8222-222222222222',
    period_start: '2026-07-01',
    period_months: 3 as const,
    period_end: '2026-09-30',
    template_name: 'Quarterly workplace inspection',
    template_version_id: '33333333-3333-4333-8333-333333333333',
    template_version: 2,
    latest_template_version: 2,
    latest_template_version_id: '33333333-3333-4333-8333-333333333333',
    overdue: false,
    ...overrides,
  };
}

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

describe('scheduledInspectionRows', () => {
  it('nombra el período, calcula el plazo y conserva el orden del servidor', () => {
    const rows = scheduledInspectionRows(
      [
        inspection({ id: 'overdue', period_end: '2026-06-30', overdue: true }),
        inspection({ id: 'future' }),
      ],
      '2026-08-15',
    );

    expect(rows.map((row) => row.inspection.id)).toEqual(['overdue', 'future']);
    expect(rows[0]?.period).toBe('Q3 2026');
    expect(rows[0]?.due).toBe('46 days overdue');
  });
});

describe('presentación de borradores locales', () => {
  it('resuelve el período contra pendientes y no lo inventa si ya no está', () => {
    expect(draftPeriodStart(draft('capturing'), [inspection()])).toBe('2026-07-01');
    expect(draftPeriodStart({ scheduled_inspection_id: 'missing' }, [inspection()])).toBeNull();
  });

  it('excluye lo aceptado y nombra cada estado sin llamar submitted a lo firmado', () => {
    expect(pendingWork([draft('capturing'), draft('signed'), draft('accepted')])).toHaveLength(2);
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
