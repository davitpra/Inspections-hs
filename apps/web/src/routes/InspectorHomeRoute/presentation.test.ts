import { describe, expect, it } from 'vitest';

import { DiscardRefusedError } from '../../offline/drafts';
import {
  assignmentState,
  availabilityLabel,
  discardRefusalMessage,
  draftPeriodStart,
  driftMessage,
  dueIn,
  focusedAssignment,
  nextAssignment,
  pendingWork,
  readiness,
  statusLabel,
} from './presentation';

/**
 * `period_end` se DERIVA de `period_start` y del largo, y no es un detalle de fixture:
 * casi todos los casos de abajo pisan solo el inicio, y con un fin fijo quedaban períodos
 * que terminan antes de empezar. Desde que «el período corriente» se mide contra los dos
 * extremos, eso dejaba de ser un fixture feo para pasar a ser uno que miente.
 */
function inspection(overrides: Record<string, unknown> = {}) {
  const base = {
    id: 'i-1',
    site_id: 's-1',
    period_start: '2026-03-01',
    period_months: 1,
    template_name: 'Monthly general workplace inspection',
    template_version_id: 'v-1',
    overdue: false,
    ...overrides,
  };

  return {
    ...base,
    period_end: periodEndOf(base.period_start as string, base.period_months as number),
  } as Parameters<typeof focusedAssignment>[0][number];
}

/** El último día del último mes que cubre el período. */
function periodEndOf(periodStart: string, periodMonths: number): string {
  const year = Number(periodStart.slice(0, 4));
  const month = Number(periodStart.slice(5, 7));
  const end = new Date(Date.UTC(year, month - 1 + periodMonths, 0));

  return end.toISOString().slice(0, 10);
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

describe('availabilityLabel', () => {
  it('dice el día en que la próxima asignación se puede empezar', () => {
    expect(availabilityLabel('2027-09-01')).toBe('Opens September 1');
    expect(availabilityLabel('2027-01-01')).toBe('Opens January 1');
  });
});

describe('draftPeriodStart', () => {
  it('resuelve el mes contra la lista del servidor, y no lo inventa cuando no está', () => {
    const items = [inspection({ id: 'i-1', period_start: '2026-03-01' })];

    expect(draftPeriodStart({ scheduled_inspection_id: 'i-1' }, items)).toBe('2026-03-01');
    expect(draftPeriodStart({ scheduled_inspection_id: 'otra' }, items)).toBeNull();
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

describe('focusedAssignment', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('devuelve null sin pendientes: es el estado vacío, no un accidente', () => {
    expect(focusedAssignment([], now)).toBeNull();
  });

  it('destaca el mes en curso cuando no hay nada vencido', () => {
    const august = inspection({ id: 'august', period_start: '2026-08-01', overdue: false });
    const items = [inspection({ id: 'december', period_start: '2025-12-01' }), august];

    expect(focusedAssignment(items, now)?.id).toBe('august');
  });

  it('lo vencido gana sobre el mes en curso, y el más antiguo entre vencidos', () => {
    const items = [
      inspection({ id: 'august', period_start: '2026-08-01', overdue: false }),
      inspection({ id: 'june', period_start: '2026-06-01', overdue: true }),
      inspection({ id: 'july', period_start: '2026-07-01', overdue: true }),
    ];

    expect(focusedAssignment(items, now)?.id).toBe('june');
  });

  it('sin nada vencido y sin nada este mes, no hay héroe', () => {
    const items = [inspection({ id: 'december', period_start: '2025-12-01', overdue: false })];

    expect(focusedAssignment(items, now)).toBeNull();
  });
});

describe('nextAssignment', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');

  it('null la mayoría de las veces: nada programado más allá del mes en curso', () => {
    expect(nextAssignment([inspection({ period_start: '2026-08-01' })], now)).toBeNull();
  });

  it('el próximo mes ya abierto, el más cercano primero', () => {
    const items = [
      inspection({ id: 'october', period_start: '2026-10-01' }),
      inspection({ id: 'september', period_start: '2026-09-01' }),
    ];

    expect(nextAssignment(items, now)?.id).toBe('september');
  });
});

describe('dueIn', () => {
  it('cuenta los días que faltan', () => {
    expect(dueIn('2026-08-30', '2026-08-15')).toBe('in 15 days');
    expect(dueIn('2026-08-16', '2026-08-15')).toBe('in 1 day');
  });

  it('hoy es hoy, no "en 0 días"', () => {
    expect(dueIn('2026-08-15', '2026-08-15')).toBe('Due today');
  });

  it('lo vencido se lee para atrás', () => {
    expect(dueIn('2026-08-10', '2026-08-15')).toBe('5 days overdue');
    expect(dueIn('2026-08-14', '2026-08-15')).toBe('1 day overdue');
  });
});

describe('assignmentState', () => {
  it('sin saber si el paquete está, no ofrece ninguna acción', () => {
    const state = assignmentState({ readiness: 'unknown', overdue: false, draftStatus: null });

    expect(state.action).toBe('none');
    expect(state.pillLabel).toBe('');
  });

  it('falta el paquete: descargar, no empezar', () => {
    const state = assignmentState({ readiness: 'not-ready', overdue: false, draftStatus: null });

    expect(state).toMatchObject({ action: 'download', actionLabel: 'Download for the field' });
  });

  it('listo y sin borrador: empezar', () => {
    const state = assignmentState({ readiness: 'ready', overdue: false, draftStatus: null });

    expect(state).toMatchObject({ action: 'start', actionLabel: 'Start inspection' });
  });

  it('con un borrador a medias: retomar', () => {
    const state = assignmentState({
      readiness: 'ready',
      overdue: false,
      draftStatus: 'capturing',
    });

    expect(state).toMatchObject({ action: 'resume', actionLabel: 'Resume inspection' });
  });

  it('firmado y esperando: abrir, no volver a empezar', () => {
    const state = assignmentState({ readiness: 'ready', overdue: false, draftStatus: 'signed' });

    expect(state).toMatchObject({ action: 'open', actionLabel: 'Open inspection' });
  });

  /**
   * El refresco NO desplaza a la acción primaria: con el paquete completo se ofrecen las
   * dos cosas. Va también con un borrador en curso o firmado, porque el roster y las
   * ubicaciones envejecen solas y se arreglan igual con la inspección empezada.
   */
  it('con el paquete completo se ofrece volver a bajarlo, sin desplazar la acción', () => {
    for (const draftStatus of [null, 'capturing', 'signed'] as const) {
      const state = assignmentState({ readiness: 'ready', overdue: false, draftStatus });

      expect(state.showsRefresh).toBe(true);
      expect(state.action).not.toBe('download');
    }
  });

  it('no se ofrece refrescar lo que todavía no está, ni antes de saberlo', () => {
    for (const state of ['not-ready', 'unknown'] as const) {
      expect(
        assignmentState({ readiness: state, overdue: false, draftStatus: null }).showsRefresh,
      ).toBe(false);
    }
  });

  /**
   * El caso que separa la píldora de la acción: un mes vencido y YA descargado sigue
   * ofreciendo "Start inspection" — lo que falta no es el paquete — pero la píldora dice
   * "Overdue" y no "Ready to start", porque eso es lo que de verdad hay que resolver.
   */
  it('vencido gana en la píldora, nunca en la acción', () => {
    const state = assignmentState({ readiness: 'ready', overdue: true, draftStatus: null });

    expect(state).toMatchObject({
      action: 'start',
      actionLabel: 'Start inspection',
      pillLabel: 'Overdue',
    });
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
});

/**
 * Los dos avisos terminan en salidas distintas, y por eso son dos textos: uno manda a
 * refrescar y el otro a descartar. El tercero no manda a ningún lado a propósito —un
 * borrador firmado no se puede descartar— y decirlo es mejor que ofrecer un botón que la
 * base va a negar.
 */
describe('driftMessage', () => {
  it('sin deriva no dice nada', () => {
    expect(driftMessage('none')).toBeNull();
  });

  it('el paquete rancio manda a refrescar', () => {
    expect(driftMessage('stale-package')).toContain('Refresh it');
  });

  it('el borrador huérfano manda a descartar', () => {
    expect(driftMessage('draft-orphaned', 'capturing')).toContain('Discard it');
  });

  it('el borrador huérfano YA FIRMADO no promete un descarte que no existe', () => {
    const message = driftMessage('draft-orphaned', 'signed');

    expect(message).not.toContain('Discard it');
    expect(message).toContain('the server will refuse it');
  });
});
