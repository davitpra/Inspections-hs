import { describe, expect, it } from 'vitest';

import {
  ACTION_STATES,
  ASSIGNEE,
  ESCALATION_DAYS,
  TRANSITIONS,
  VERIFIER_ROLES,
  type ActionState,
  actionListSchema,
  actionSummarySchema,
  createActionRequestSchema,
  escalationLevelsDue,
  transitionFor,
  transitionRequestSchema,
  transitionsFrom,
} from './index.js';

const PERSON_ID = '11111111-1111-4111-8111-111111111111';

/**
 * La tabla de casos de la máquina de estados.
 *
 * Los 20 pares ordenados de los cuatro estados, más los 4 que salen de `null`,
 * cada uno afirmado a mano. No se genera de `TRANSITIONS` a propósito: una tabla
 * derivada de la implementación no prueba nada, solo se copia el error.
 */
const ACCEPTED: ReadonlyArray<[ActionState | null, ActionState]> = [
  [null, 'open'],
  ['open', 'in_progress'],
  ['in_progress', 'awaiting_verification'],
  ['awaiting_verification', 'closed'],
  ['awaiting_verification', 'in_progress'],
];

function isAccepted(from: ActionState | null, to: ActionState): boolean {
  return ACCEPTED.some(([f, t]) => f === from && t === to);
}

describe('la máquina de estados', () => {
  const froms: ReadonlyArray<ActionState | null> = [null, ...ACTION_STATES];

  for (const from of froms) {
    for (const to of ACTION_STATES) {
      const label = `${from ?? '(creación)'} → ${to}`;

      it(`${isAccepted(from, to) ? 'acepta' : 'rechaza'} ${label}`, () => {
        expect(transitionFor(from, to) !== undefined).toBe(isAccepted(from, to));
      });
    }
  }

  it('cubre los 20 pares ordenados de los cuatro estados más los 4 de la creación', () => {
    expect(froms.length * ACTION_STATES.length).toBe(20);
  });

  it('`closed` es terminal: ninguna transición sale de ahí', () => {
    expect(transitionsFrom('closed')).toEqual([]);
    expect(TRANSITIONS.every((transition) => transition.from !== 'closed')).toBe(true);
  });

  it('ningún estado transiciona a sí mismo', () => {
    expect(TRANSITIONS.every((transition) => transition.from !== transition.to)).toBe(true);
  });

  it('solo la creación sale de `null`, y solo lleva a `open`', () => {
    expect(transitionsFrom(null)).toHaveLength(1);
    expect(transitionsFrom(null)[0]?.to).toBe('open');
    expect(transitionsFrom(null)[0]?.roles).toEqual(['hs_coordinator']);
  });

  it('toda transición que exige `not_executor` sale de `awaiting_verification`', () => {
    const guarded = TRANSITIONS.filter((transition) => transition.requires.includes('not_executor'));

    expect(guarded).toHaveLength(2);
    expect(guarded.every((transition) => transition.from === 'awaiting_verification')).toBe(true);
  });

  it('solo el rechazo de una verificación exige `reason`', () => {
    const needsReason = TRANSITIONS.filter((transition) => transition.requires.includes('reason'));

    expect(needsReason).toHaveLength(1);
    expect(needsReason[0]?.from).toBe('awaiting_verification');
    expect(needsReason[0]?.to).toBe('in_progress');
  });

  it('ninguna transición exige evidencia', () => {
    expect(TRANSITIONS.flatMap((transition) => transition.requires)).not.toContain('after_evidence');
  });

  it('el responsable solo puede ejecutar, nunca verificar', () => {
    const assigneeCan = TRANSITIONS.filter((transition) => transition.roles.includes(ASSIGNEE));

    expect(assigneeCan.map((transition) => transition.to)).toEqual([
      'in_progress',
      'awaiting_verification',
    ]);
    expect(VERIFIER_ROLES).not.toContain(ASSIGNEE);
  });

  it('los verificadores son el coordinador, el supervisor y gerencia', () => {
    expect([...VERIFIER_ROLES].sort()).toEqual(['hs_coordinator', 'management', 'supervisor']);
  });

  it('un miembro del JHSC y un auditor externo no aparecen en ninguna transición', () => {
    const actors = new Set(TRANSITIONS.flatMap((transition) => transition.roles));

    expect(actors.has('jhsc_member')).toBe(false);
    expect(actors.has('external_auditor')).toBe(false);
  });
});

describe('el escalamiento', () => {
  const DUE = new Date('2026-08-10T13:00:00.000Z');

  function at(days: number): Date {
    return new Date(DUE.getTime() + days * 24 * 60 * 60 * 1000);
  }

  it('dentro del plazo no escala', () => {
    expect(escalationLevelsDue(DUE, at(-1))).toEqual([]);
  });

  it('a los 2 días de atraso todavía no escala', () => {
    expect(escalationLevelsDue(DUE, at(2))).toEqual([]);
  });

  it('a los 4 días escala al supervisor', () => {
    expect(escalationLevelsDue(DUE, at(4))).toEqual(['supervisor']);
  });

  it('a los 8 días escala a los dos niveles', () => {
    expect(escalationLevelsDue(DUE, at(8))).toEqual(['supervisor', 'management']);
  });

  it('los umbrales son los +3 y +7 de R3', () => {
    expect(ESCALATION_DAYS).toEqual({ supervisor: 3, management: 7 });
  });
});

describe('los requests', () => {
  it('crear una acción lleva su fecha límite', () => {
    const result = createActionRequestSchema.safeParse({
      assignee_person_id: PERSON_ID,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: '2027-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
  });

  /** Sin fecha no hay obligación: una acción que no vence no escala nunca. */
  it('crear una acción sin `due_at` se rechaza', () => {
    const result = createActionRequestSchema.safeParse({
      assignee_person_id: PERSON_ID,
      description: 'Install a fixed guard on the infeed of line 3',
    });

    expect(result.success).toBe(false);
  });

  /** La severidad se retiró con la clasificación (ADR-014) y el objeto es estricto. */
  it('crear una acción no acepta `severity`', () => {
    const result = createActionRequestSchema.safeParse({
      assignee_person_id: PERSON_ID,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: '2027-01-01T00:00:00.000Z',
      severity: 'major',
    });

    expect(result.success).toBe(false);
  });

  it('una descripción de dos caracteres se rechaza', () => {
    const result = createActionRequestSchema.safeParse({
      assignee_person_id: PERSON_ID,
      description: 'fix',
      due_at: '2027-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('declarar el trabajo hecho sin evidencia se acepta', () => {
    const result = transitionRequestSchema.safeParse({
      to: 'awaiting_verification',
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.evidence).toEqual([]);
  });

  it('declarar el trabajo hecho con evidencia `after` se acepta', () => {
    const result = transitionRequestSchema.safeParse({
      to: 'awaiting_verification',
      evidence: [
        { kind: 'before', object_key: 'site/actions/id/a.jpg' },
        { kind: 'after', object_key: 'site/actions/id/b.jpg' },
      ],
    });

    expect(result.success).toBe(true);
  });

  it('iniciar una acción no exige evidencia', () => {
    expect(transitionRequestSchema.safeParse({ to: 'in_progress' }).success).toBe(true);
  });

  it('un estado inventado se rechaza', () => {
    expect(transitionRequestSchema.safeParse({ to: 'escalated' }).success).toBe(false);
  });
});

describe('el resumen del listado', () => {
  const ACTION_ID = '22222222-2222-4222-8222-222222222222';
  const SITE_ID = '33333333-3333-4333-8333-333333333333';
  const FINDING_ID = '44444444-4444-4444-8444-444444444444';
  const INSPECTION_ID = '55555555-5555-4555-8555-555555555555';
  const SCHEDULED_ID = '66666666-6666-4666-8666-666666666666';
  const TEMPLATE_ID = '77777777-7777-4777-8777-777777777777';
  const INVESTIGATION_ID = '88888888-8888-4888-8888-888888888888';

  const summary = (source: unknown) => ({
    id: ACTION_ID,
    site_id: SITE_ID,
    site_name: 'Glencoe',
    assignee_person_id: PERSON_ID,
    assignee_name: 'Dana Okafor',
    description: 'Install a fixed guard on the infeed of line 3',
    due_at: '2026-08-28T16:00:00.000Z',
    state: 'open',
    overdue: false,
    escalations: [],
    source,
  });

  it.each([
    {
      kind: 'inspection',
      finding_id: FINDING_ID,
      inspection_id: INSPECTION_ID,
      scheduled_inspection_id: SCHEDULED_ID,
      template_id: TEMPLATE_ID,
      template_name: 'Monthly workplace inspection',
    },
    { kind: 'manual_finding', finding_id: FINDING_ID },
    { kind: 'investigation', investigation_id: INVESTIGATION_ID },
  ])('acepta la fuente $kind', (source) => {
    expect(actionSummarySchema.safeParse(summary(source)).success).toBe(true);
  });

  it('el listado no acepta el historial de detalle', () => {
    const withHistory = {
      ...summary({ kind: 'manual_finding', finding_id: FINDING_ID }),
      events: [],
    };

    expect(actionListSchema.safeParse([withHistory]).success).toBe(false);
  });

  it('una fuente no puede mezclar campos de dos orígenes', () => {
    const result = actionSummarySchema.safeParse(
      summary({
        kind: 'manual_finding',
        finding_id: FINDING_ID,
        investigation_id: INVESTIGATION_ID,
      }),
    );

    expect(result.success).toBe(false);
  });
});
