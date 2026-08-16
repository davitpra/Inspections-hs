import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import {
  discardRefusalMessage,
  draftPeriodStart,
  earliestPendingYear,
  initialYear,
  pendingCardClass,
  pendingOfYear,
  pendingStats,
  pendingWork,
  readiness,
  statusLabel,
  submittedFromDevice,
} from './presentation';

function inspection(overrides: Record<string, unknown> = {}) {
  return {
    id: 'i-1',
    site_id: 's-1',
    period_start: '2026-03-01',
    period_end: '2026-03-31',
    template_name: 'Monthly general workplace inspection',
    template_version_id: 'v-1',
    overdue: false,
    ...overrides,
  } as Parameters<typeof pendingOfYear>[0][number];
}

describe('statusLabel', () => {
  it('no llama "submitted" a lo que todavía no salió del dispositivo', () => {
    expect(statusLabel('capturing')).toBe('Draft');
    expect(statusLabel('signed')).toBe('Signed, waiting to send');
    expect(statusLabel('accepted')).toBe('Submitted');
  });
});

describe('readiness', () => {
  /**
   * El caso que importa es el tercero: mientras la consulta no resolvió no se sabe, y no
   * saber NO es "no está lista". De esa distinción depende que la tarjeta no ofrezca
   * empezar una inspección cuyo formulario todavía no se sabe si está en el dispositivo.
   */
  it('distingue no saber de no estar lista', () => {
    expect(readiness([])).toBe('ready');
    expect(readiness(['roster'])).toBe('not-ready');
    expect(readiness(undefined)).toBe('unknown');
  });
});

describe('pendingCardClass', () => {
  it('lo vencido gana sobre el estado del paquete', () => {
    expect(pendingCardClass('ready', true)).toBe('period period--missed');
    expect(pendingCardClass('not-ready', true)).toBe('period period--missed');
  });

  it('falta de paquete se avisa, no se alarma', () => {
    expect(pendingCardClass('not-ready', false)).toBe('period period--not-ready');
    expect(pendingCardClass('ready', false)).toBe('period period--open');
    expect(pendingCardClass('unknown', false)).toBe('period period--open');
  });
});

describe('el año que se mira', () => {
  it('lista un año en orden de mes', () => {
    const items = [
      inspection({ id: 'a', period_start: '2026-05-01' }),
      inspection({ id: 'b', period_start: '2025-12-01' }),
      inspection({ id: 'c', period_start: '2026-02-01' }),
    ];

    expect(pendingOfYear(items, '2026').map((item) => item.id)).toEqual(['c', 'a']);
  });

  it('deja retroceder hasta el pendiente más viejo y no más', () => {
    const items = [inspection({ period_start: '2024-11-01' })];

    expect(earliestPendingYear(items, '2026')).toBe('2024');
    expect(earliestPendingYear([], '2026')).toBe('2026');
  });

  /**
   * La pantalla de inicio no puede abrir vacía teniendo trabajo atrasado: el inspector
   * concluye que no debe nada y las vencidas quedan a un clic que nunca va a dar.
   */
  it('abre en el año en curso solo cuando ese año tiene algo', () => {
    const now = new Date('2026-08-15T12:00:00.000Z');

    expect(initialYear([inspection({ period_start: '2026-03-01' })], now)).toBe('2026');
    expect(initialYear([inspection({ period_start: '2025-12-01' })], now)).toBe('2025');
    expect(initialYear([], now)).toBe('2026');
  });
});

describe('draftPeriodStart', () => {
  it('resuelve el mes contra la lista del servidor, y no lo inventa cuando no está', () => {
    const items = [inspection({ id: 'i-1', period_start: '2026-03-01' })];

    expect(draftPeriodStart({ scheduled_inspection_id: 'i-1' }, items)).toBe('2026-03-01');
    expect(draftPeriodStart({ scheduled_inspection_id: 'otra' }, items)).toBeNull();
  });
});

describe('pendingStats', () => {
  it('cuenta lo vencido aparte del estado del paquete', () => {
    const stats = pendingStats([
      { overdue: true, state: 'not-ready' },
      { overdue: false, state: 'ready' },
      { overdue: false, state: 'unknown' },
    ]);

    expect(stats).toEqual({ total: 3, ready: 1, notReady: 1, overdue: 1 });
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
