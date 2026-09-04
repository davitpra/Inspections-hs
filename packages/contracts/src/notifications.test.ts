import { describe, expect, it } from 'vitest';

import { NOTIFICATION_KINDS, notificationSchema } from './notifications.js';

const ID = '11111111-1111-4111-8111-111111111111';
const SITE_ID = '22222222-2222-4222-8222-222222222222';
const ACTION_ID = '33333333-3333-4333-8333-333333333333';
const FINDING_ID = '44444444-4444-4444-8444-444444444444';
const PERSON_ID = '55555555-5555-4555-8555-555555555555';

function envelope(kind: string, payload: unknown) {
  return {
    id: ID,
    site_id: SITE_ID,
    kind,
    payload,
    created_at: '2026-08-10T13:00:00.000Z',
    read_at: null,
  };
}

const PERIOD_OPENED = {
  opened_for_month: '2026-08-01',
  opened: [
    {
      scheduled_inspection_id: ACTION_ID,
      template_id: FINDING_ID,
      template_name: 'Monthly greenhouse walk',
      inspector_id: null,
      period_start: '2026-08-01',
      period_end: '2026-08-31',
      period_months: 1,
    },
  ],
};

const ASSIGNED = {
  action_id: ACTION_ID,
  finding_id: FINDING_ID,
  description: 'Install a fixed guard on the infeed of line 3',
  due_at: '2026-08-17T13:00:00.000Z',
};

const OVERDUE = {
  action_id: ACTION_ID,
  finding_id: FINDING_ID,
  description: 'Install a fixed guard on the infeed of line 3',
  assignee_person_id: PERSON_ID,
  due_at: '2026-08-17T13:00:00.000Z',
  days_overdue: 4,
};

describe('notificationSchema', () => {
  it('acepta la apertura de período', () => {
    expect(notificationSchema.safeParse(envelope('inspection_period_opened', PERIOD_OPENED)).success).toBe(
      true,
    );
  });

  it('acepta la asignación de una acción', () => {
    expect(notificationSchema.safeParse(envelope('corrective_action_assigned', ASSIGNED)).success).toBe(
      true,
    );
  });

  it('acepta los dos escalamientos', () => {
    for (const kind of [
      'corrective_action_overdue_supervisor',
      'corrective_action_overdue_management',
    ]) {
      expect(notificationSchema.safeParse(envelope(kind, OVERDUE)).success).toBe(true);
    }
  });

  it('acepta el escalamiento de una acción de investigación sin hallazgo', () => {
    expect(
      notificationSchema.safeParse(
        envelope('corrective_action_overdue_supervisor', { ...OVERDUE, finding_id: null }),
      ).success,
    ).toBe(true);
  });

  /**
   * Lo que la unión discriminada compra (design D11): antes, cualquier `kind` de la
   * lista con el payload del período pasaba. Ahora el payload tiene que ser el de SU
   * tipo, que es la única forma de que la bandeja pueda confiar en lo que recibe.
   */
  it('rechaza un payload que no es el de su kind', () => {
    expect(
      notificationSchema.safeParse(envelope('corrective_action_assigned', PERIOD_OPENED)).success,
    ).toBe(false);
  });

  it('rechaza una asignación sin `due_at`', () => {
    const { due_at: _omitted, ...withoutDueAt } = ASSIGNED;

    expect(
      notificationSchema.safeParse(envelope('corrective_action_assigned', withoutDueAt)).success,
    ).toBe(false);
  });

  /** La severidad se retiró con la clasificación (ADR-014) y el payload es estricto. */
  it('rechaza una severidad', () => {
    expect(
      notificationSchema.safeParse(
        envelope('corrective_action_assigned', { ...ASSIGNED, severity: 'major' }),
      ).success,
    ).toBe(false);
  });

  /** Una acción de investigación no tiene hallazgo del que colgar. */
  it('acepta el aviso de una acción sin hallazgo', () => {
    expect(
      notificationSchema.safeParse(
        envelope('corrective_action_assigned', { ...ASSIGNED, finding_id: null }),
      ).success,
    ).toBe(true);
  });

  /** Un `kind` que la base tenga y el contrato no: falla ruidoso, no se renderiza vacío. */
  it('rechaza un kind desconocido', () => {
    expect(notificationSchema.safeParse(envelope('action_escalated', OVERDUE)).success).toBe(false);
  });

  it('la lista de kinds y las variantes de la unión son la misma lista', () => {
    const variants = notificationSchema.options.map((option) => option.shape.kind.value);

    expect([...variants].sort()).toEqual([...NOTIFICATION_KINDS].sort());
  });
});
