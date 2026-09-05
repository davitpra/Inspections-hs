import { describe, expect, it } from 'vitest';
import {
  ASSIGNEE,
  ROLES,
  transitionsFrom,
  type Action,
  type ActionState,
  type Finding,
  type Session,
} from '@hs/contracts';

import { canAttempt, canCreateAction, canEditAssignment } from './actions';

const PERSON = '11111111-1111-4111-8111-111111111111';
const OTHER_PERSON = '22222222-2222-4222-8222-222222222222';
const DEFAULT_ACCOUNT = '77777777-7777-4777-8777-777777777777';
const REPORTER_ACCOUNT = '88888888-8888-4888-8888-888888888888';

function action(state: ActionState): Action {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    site_id: '44444444-4444-4444-8444-444444444444',
    investigation_id: null,
    finding_id: '55555555-5555-4555-8555-555555555555',
    assignee_person_id: PERSON,
    description: 'Install a fixed guard on the infeed of line 3',
    due_at: '2026-08-17T13:00:00.000Z',
    remediation_group_id: null,
    created_by: '66666666-6666-4666-8666-666666666666',
    created_at: '2026-08-10T13:00:00.000Z',
    state,
    overdue: false,
    events: [],
    escalations: [],
  };
}

function session(role: Session['role'], personId = PERSON, userId = DEFAULT_ACCOUNT): Session {
  return {
    userId,
    personId,
    role,
    siteScope: ['44444444-4444-4444-8444-444444444444'],
    recordsFrom: null,
    recordsTo: null,
  };
}

function finding(reportedBy = REPORTER_ACCOUNT): Pick<Finding, 'reported_by'> {
  return { reported_by: reportedBy };
}

describe('la creación de acciones (ADR-017)', () => {
  it('se ofrece al coordinador aunque no haya reportado el hallazgo', () => {
    for (const role of ROLES) {
      expect(canCreateAction(session(role), finding())).toBe(role === 'hs_coordinator');
    }
  });

  it('se ofrece a quien reportó el hallazgo, sea cual sea su rol', () => {
    for (const role of ROLES) {
      const reporter = session(role, PERSON, REPORTER_ACCOUNT);

      expect(canCreateAction(reporter, finding(REPORTER_ACCOUNT))).toBe(true);
    }
  });

  it('no se ofrece a un jhsc_member que no reportó este hallazgo', () => {
    const otherJhsc = session('jhsc_member', PERSON, DEFAULT_ACCOUNT);

    expect(canCreateAction(otherJhsc, finding(REPORTER_ACCOUNT))).toBe(false);
  });

  it('no se ofrece sin sesión', () => {
    expect(canCreateAction(null, finding())).toBe(false);
  });
});

describe('la edición de la asignación (ADR-021)', () => {
  it('se autoriza igual que abrir la acción: coordinador o quien reportó', () => {
    for (const role of ROLES) {
      expect(canEditAssignment(session(role), finding())).toBe(role === 'hs_coordinator');
      expect(
        canEditAssignment(session(role, PERSON, REPORTER_ACCOUNT), finding(REPORTER_ACCOUNT)),
      ).toBe(true);
    }
  });

  it('no se ofrece sin sesión', () => {
    expect(canEditAssignment(null, finding())).toBe(false);
  });
});

/** Lo que la pantalla ofrece, derivado de la misma tabla que el servidor aplica. */
function offered(state: ActionState, actor: Session | null): string[] {
  return transitionsFrom(state)
    .filter((transition) => canAttempt(transition, action(state), actor))
    .map((transition) => transition.to);
}

describe('los botones del detalle', () => {
  it('el responsable puede empezar y declarar el trabajo hecho, y nada más', () => {
    const assignee = session('supervisor', PERSON);

    expect(offered('open', assignee)).toEqual(['in_progress']);
    expect(offered('in_progress', assignee)).toEqual(['awaiting_verification']);
  });

  it('un supervisor que no es el responsable no puede declararla hecha', () => {
    // `supervisor` no está entre los roles de `open → in_progress`: ahí solo están el
    // responsable y el coordinador. Que la cuenta sea supervisora no la vuelve dueña de la
    // acción de otro.
    expect(offered('open', session('supervisor', OTHER_PERSON))).toEqual([]);
  });

  it('el coordinador puede avanzar en nombre de otro', () => {
    const coordinator = session('hs_coordinator', OTHER_PERSON);

    expect(offered('open', coordinator)).toEqual(['in_progress']);
    expect(offered('in_progress', coordinator)).toEqual(['awaiting_verification']);
  });

  it('un supervisor cualquiera sí puede verificar', () => {
    expect(offered('awaiting_verification', session('supervisor', OTHER_PERSON)).sort()).toEqual([
      'closed',
      'in_progress',
    ]);
  });

  it('gerencia verifica y no ejecuta', () => {
    const management = session('management', OTHER_PERSON);

    expect(offered('open', management)).toEqual([]);
    expect(offered('awaiting_verification', management).sort()).toEqual(['closed', 'in_progress']);
  });

  it('un miembro del JHSC y un auditor externo no ven ningún botón', () => {
    for (const role of ['jhsc_member', 'external_auditor'] as const) {
      for (const state of ['open', 'in_progress', 'awaiting_verification'] as const) {
        expect(offered(state, session(role, OTHER_PERSON))).toEqual([]);
      }
    }
  });

  it('una acción cerrada no ofrece nada a nadie', () => {
    for (const role of ['hs_coordinator', 'supervisor', 'management'] as const) {
      expect(offered('closed', session(role))).toEqual([]);
    }
  });

  it('sin sesión no se ofrece nada', () => {
    expect(offered('open', null)).toEqual([]);
  });

  /**
   * La regla del verificador NO vive acá y este test lo fija: la pantalla ofrece el
   * botón y el servidor responde `verifier_is_executor`. Media regla copiada en el
   * cliente es una que puede separarse de la otra mitad sin que nada se queje.
   */
  it('la pantalla no intenta adivinar si quien mira fue el ejecutor', () => {
    const executor = session('supervisor', PERSON);

    expect(offered('awaiting_verification', executor)).toContain('closed');
  });

  it('el responsable no aparece como rol en las transiciones de verificación', () => {
    const verifying = transitionsFrom('awaiting_verification');

    expect(verifying.every((transition) => !transition.roles.includes(ASSIGNEE))).toBe(true);
  });
});
