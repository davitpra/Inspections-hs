import { describe, expect, it } from 'vitest';

import {
  ACTION_STATES,
  ASSIGNEE,
  DUE_DAYS_BY_SEVERITY,
  ESCALATION_DAYS,
  SEVERITIES,
  TRANSITIONS,
  VERIFIER_ROLES,
  type ActionState,
  createActionRequestSchema,
  dueAt,
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

  it('solo declarar el trabajo hecho exige evidencia `after`', () => {
    const needsEvidence = TRANSITIONS.filter((transition) =>
      transition.requires.includes('after_evidence'),
    );

    expect(needsEvidence).toHaveLength(1);
    expect(needsEvidence[0]?.to).toBe('awaiting_verification');
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

describe('la fecha límite', () => {
  const FROM = new Date('2026-08-10T13:00:00.000Z');

  const CASES: ReadonlyArray<[(typeof SEVERITIES)[number], number]> = [
    ['catastrophic', 3],
    ['major', 7],
    ['moderate', 14],
    ['minor', 30],
    ['negligible', 60],
  ];

  for (const [severity, days] of CASES) {
    it(`${severity} vence a los ${days} días`, () => {
      const result = dueAt(severity, FROM);

      expect(result.getTime() - FROM.getTime()).toBe(days * 24 * 60 * 60 * 1000);
    });
  }

  it('cubre las cinco severidades y ninguna más', () => {
    expect(Object.keys(DUE_DAYS_BY_SEVERITY).sort()).toEqual([...SEVERITIES].sort());
  });

  it('a más severidad, menos plazo', () => {
    const days = SEVERITIES.map((severity) => DUE_DAYS_BY_SEVERITY[severity]);

    expect(days).toEqual([...days].sort((a, b) => b - a));
  });

  /**
   * El comportamiento que design D5 acepta: el plazo son N × 24 horas exactas y no
   * N días de calendario, así que cruzar el cambio de horario de Ontario mueve la
   * hora local del vencimiento. Con un cron que corre a las 03:00 y umbrales de 3
   * y 7 días, una hora no tiene consecuencia — pero queda afirmado para que un
   * cambio futuro a días de calendario sea una decisión y no un accidente.
   */
  it('cruzar el cambio de horario mueve la hora local, no el plazo', () => {
    // 2026-11-01 es el fin del horario de verano en Ontario.
    const before = new Date('2026-10-29T13:00:00.000Z');
    const result = dueAt('major', before);

    expect(result.toISOString()).toBe('2026-11-05T13:00:00.000Z');
    expect(result.getTime() - before.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
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
  it('crear una acción no acepta `due_at` ni `severity`', () => {
    const result = createActionRequestSchema.safeParse({
      assignee_person_id: PERSON_ID,
      description: 'Install a fixed guard on the infeed of line 3',
      due_at: '2027-01-01T00:00:00.000Z',
    });

    expect(result.success).toBe(false);
  });

  it('una descripción de dos caracteres se rechaza', () => {
    const result = createActionRequestSchema.safeParse({
      assignee_person_id: PERSON_ID,
      description: 'fix',
    });

    expect(result.success).toBe(false);
  });

  it('declarar el trabajo hecho sin evidencia `after` se rechaza', () => {
    const result = transitionRequestSchema.safeParse({
      to: 'awaiting_verification',
      evidence: [{ kind: 'before', object_key: 'site/actions/id/a.jpg' }],
    });

    expect(result.success).toBe(false);
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
