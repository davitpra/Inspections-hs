import { describe, expect, it } from 'vitest';
import { NOTIFICATION_KINDS, notificationSchema } from '@hs/contracts';

const ID = '11111111-1111-4111-8111-111111111111';
const SITE = '22222222-2222-4222-8222-222222222222';
const ACTION = '33333333-3333-4333-8333-333333333333';
const FINDING = '44444444-4444-4444-8444-444444444444';
const PERSON = '55555555-5555-4555-8555-555555555555';
const INCIDENT = '66666666-6666-4666-8666-666666666666';

function envelope(kind: string, payload: unknown) {
  return {
    id: ID,
    site_id: SITE,
    kind,
    payload,
    created_at: '2026-08-10T13:00:00.000Z',
    read_at: null,
  };
}

/**
 * Lo que la bandeja tiene que poder mostrar, y la razón por la que el `switch` de
 * `InboxRoute` no lleva `default`.
 *
 * El contrato es una unión discriminada (design D11): un `kind` nuevo sin rama de
 * renderizado no compila. Este test cubre la otra mitad —que la lista del contrato y lo
 * que la bandeja sabe leer sean la misma— y que un tipo desconocido llegado de la base
 * falle ruidoso en vez de renderizarse vacío.
 */
describe('los tipos que la bandeja sabe leer', () => {
  const RENDERED_KINDS = [
    'inspection_period_opened',
    'corrective_action_assigned',
    'corrective_action_overdue_supervisor',
    'corrective_action_overdue_management',
    'incident_reported',
  ];

  it('cubre todos los kinds del contrato y ninguno de más', () => {
    expect([...RENDERED_KINDS].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });

  it('acepta el payload de cada tipo', () => {
    const payloads: Record<string, unknown> = {
      inspection_period_opened: {
        period_start: '2026-08-01',
        period_end: '2026-08-31',
        opened: [],
      },
      corrective_action_assigned: {
        action_id: ACTION,
        finding_id: FINDING,
        description: 'Install a fixed guard on the infeed of line 3',
        severity: 'major',
        due_at: '2026-08-17T13:00:00.000Z',
      },
      corrective_action_overdue_supervisor: {
        action_id: ACTION,
        finding_id: FINDING,
        description: 'Install a fixed guard on the infeed of line 3',
        assignee_person_id: PERSON,
        due_at: '2026-08-17T13:00:00.000Z',
        days_overdue: 4,
      },
    };

    payloads.corrective_action_overdue_management =
      payloads.corrective_action_overdue_supervisor;

    payloads.incident_reported = {
      incident_id: INCIDENT,
      classification: 'critical_injury',
      occurred_at: '2026-03-02T13:00:00.000Z',
      reported_at: '2026-03-02T14:00:00.000Z',
    };

    for (const kind of RENDERED_KINDS) {
      expect(notificationSchema.safeParse(envelope(kind, payloads[kind])).success).toBe(true);
    }
  });

  it('un kind que la bandeja no conoce no parsea', () => {
    expect(notificationSchema.safeParse(envelope('action_escalated', {})).success).toBe(false);
  });

  /**
   * La otra mitad de design D11: `notification` no tiene la política de visibilidad del
   * incidente, así que un payload con la identidad de la persona accidentada saltearía
   * por una tabla adyacente la regla RLS que 0012 escribió.
   */
  it('el aviso de incidente no admite la identidad del sujeto', () => {
    const leaky = {
      incident_id: INCIDENT,
      classification: 'critical_injury',
      occurred_at: '2026-03-02T13:00:00.000Z',
      reported_at: '2026-03-02T14:00:00.000Z',
      subject_person_id: PERSON,
    };

    expect(notificationSchema.safeParse(envelope('incident_reported', leaky)).success).toBe(
      false,
    );
  });

  it('tampoco admite narrativa', () => {
    const leaky = {
      incident_id: INCIDENT,
      classification: 'critical_injury',
      occurred_at: '2026-03-02T13:00:00.000Z',
      reported_at: '2026-03-02T14:00:00.000Z',
      what_happened: 'The load shifted and struck the worker',
    };

    expect(notificationSchema.safeParse(envelope('incident_reported', leaky)).success).toBe(
      false,
    );
  });
});
